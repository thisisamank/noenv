import { test } from "node:test";
import assert from "node:assert/strict";
import { nameFromHost } from "../src/deployment.ts";

test("the fallback team name comes from the Worker's address", () => {
  assert.equal(nameFromHost("noenv.thisisamank.workers.dev"), "thisisamank");
  assert.equal(nameFromHost("noenv.acme.com"), "acme");
  assert.equal(nameFromHost("secrets.globex.io"), "globex");
  assert.equal(nameFromHost("localhost"), "localhost");
});
