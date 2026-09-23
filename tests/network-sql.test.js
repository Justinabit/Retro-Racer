import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// Real Postgres parser, triggers, row locks, functions and RLS in WASM. Auth and
// Realtime schemas are minimal fixtures, not a substitute for a deployed
// Supabase websocket authorization smoke test.
const alice = "00000000-0000-4000-8000-000000000001";
const bob = "00000000-0000-4000-8000-000000000002";
const eve = "00000000-0000-4000-8000-000000000003";
const lobby = "00000000-0000-4000-8000-000000000010";
test("Postgres migration: atomic start, frozen roster, authenticated topics and idempotent ranked finishes", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated; create role anon;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
      create function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;
      create schema realtime;
      create table realtime.messages(id bigint generated always as identity, extension text);
      alter table realtime.messages enable row level security;
      create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic', true)$$;
      grant usage on schema public, auth, realtime to authenticated;
      grant select, insert on realtime.messages to authenticated;
    `);
    for (const file of [
      "001_initial_schema.sql",
      "002_functions_and_triggers.sql",
      "003_rls_policies.sql",
      "005_race_network.sql",
    ]) {
      // UUID generation is built into Postgres; optional extension installers
      // are unavailable in WASM and irrelevant to this migration's behavior.
      const sql = readFileSync(
        new URL(`../supabase/migrations/${file}`, import.meta.url),
        "utf8",
      ).replace(/^create extension.*;$/gm, "");
      await db.exec(sql);
    }
    await db.exec(`
      insert into auth.users values ('${alice}'),('${bob}'),('${eve}');
      insert into public.profiles(id,username) values ('${alice}','Alice'),('${bob}','Bob'),('${eve}','Eve');
      insert into public.lobbies(id,code,host_id) values ('${lobby}','123456','${alice}');
      insert into public.lobby_players(lobby_id,player_id,is_ready) values ('${lobby}','${alice}',true),('${lobby}','${bob}',true);
    `);
    const user = async (id) => {
      await db.exec(
        `reset role; set request.jwt.claim.sub = '${id}'; set role authenticated;`,
      );
    };
    await user(bob);
    await assert.rejects(
      db.query("select public.start_race($1)", [lobby]),
      /Host only/,
    );
    await user(alice);
    const { rows } = await db.query("select * from public.start_race($1)", [
      lobby,
    ]);
    const race = rows[0].race_id;
    assert.ok(race);
    assert.equal(rows[0].status, "starting");
    assert.ok(new Date(rows[0].race_start_at).getTime() > Date.now());
    assert.equal(
      (await db.query("select * from public.race_members")).rows.length,
      2,
    );
    await assert.rejects(
      db.query("select public.start_race($1)", [lobby]),
      /Host only/,
    );
    // RLS cannot accept Alice writing Bob's topic, even when payload lies.
    const can = async (sender, writing) =>
      (
        await db.query("select public.race_topic_allowed($1,$2) as ok", [
          `race:${race}:${sender}`,
          writing,
        ])
      ).rows[0].ok;
    assert.equal(await can(alice, true), true);
    assert.equal(await can(bob, true), false);
    assert.equal(await can(bob, false), true);
    await db.exec(`set realtime.topic = 'race:${race}:${bob}';`);
    await assert.rejects(
      db.exec("insert into realtime.messages(extension) values ('broadcast')"),
      /row-level security/,
    );
    await db.exec(
      `set realtime.topic = 'race:${race}:${alice}'; insert into realtime.messages(extension) values ('broadcast');`,
    );
    await user(eve);
    assert.equal(await can(alice, false), false);
    assert.equal(
      (await db.query("select * from public.race_members")).rows.length,
      0,
    );
    await user(alice);
    await assert.rejects(
      db.query("select public.submit_race_finish($1,$2)", [race, 12]),
      /precedes/,
    );
    await db.exec(
      `reset role; update race_sessions set started_at = now() - interval '150 seconds' where id = '${race}';`,
    );
    await assert.rejects(
      db.exec(
        `update lobby_players set selected_car = 'demon' where player_id = '${alice}'`,
      ),
      /locked/,
    );
    await user(bob);
    await db.query("select public.submit_race_finish($1,$2)", [race, 125]);
    await user(alice);
    await db.query("select public.submit_race_finish($1,$2)", [race, 120]);
    await db.query("select public.submit_race_finish($1,$2)", [race, 1]); // duplicate cannot replace finish
    await db.exec("reset role;");
    const results = (
      await db.query(
        "select player_id,finish_time,finishing_position from race_results order by finishing_position",
      )
    ).rows;
    assert.deepEqual(results, [
      { player_id: alice, finish_time: 120, finishing_position: 1 },
      { player_id: bob, finish_time: 125, finishing_position: 2 },
    ]);
    assert.equal(
      (await db.query("select status from lobbies")).rows[0].status,
      "finished",
    );
    await db.exec(
      "grant select, delete on lobby_players to authenticated; grant select on lobbies to authenticated;",
    );
    await user(alice);
    await db.query("delete from lobby_players where player_id = $1", [alice]);
    assert.equal(
      (await db.query("select host_id from lobbies")).rows[0].host_id,
      bob,
    );
    await user(bob);
    await db.query("delete from lobby_players where player_id = $1", [bob]);
    assert.equal(
      (await db.query("select status from lobbies")).rows[0].status,
      "closed",
    );
    assert.ok(
      readFileSync(
        new URL("../supabase/schema.sql", import.meta.url),
        "utf8",
      ).endsWith(
        readFileSync(
          new URL(
            "../supabase/migrations/005_race_network.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    );
  } finally {
    await db.close();
  }
});
