import test from "node:test";
import assert from "node:assert/strict";

import { applyCliOverrides, loadConfig } from "../scripts/lib/config.mjs";

test("download collaboration defaults are enabled", async () => {
  const { config } = await loadConfig({
    skillRoot: "/path/that/does/not/exist",
    env: {}
  });

  assert.equal(config.download.authenticatedDirectFetch, true);
  assert.equal(config.download.manualInterventionQueue, true);
});

test("cli flags can disable authenticated fetch and manual queue", () => {
  const config = applyCliOverrides({}, {
    noAuthenticatedDirectFetch: true,
    noManualQueue: true
  });

  assert.equal(config.download.authenticatedDirectFetch, false);
  assert.equal(config.download.manualInterventionQueue, false);
});
