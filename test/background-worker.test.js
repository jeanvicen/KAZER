const test = require("node:test");
const assert = require("node:assert/strict");
const { attachBackgroundTaskContext, getBackgroundTaskContext } = require("../server/tasks/_background-context");
const { invokeTask } = require("../worker/background-worker");

test("trusted background context is process-local, not supplied by HTTP headers", () => {
  const request = { headers: { "x-kazer-background-user": "attacker" }, body: { userId: "attacker" } };
  assert.equal(getBackgroundTaskContext(request), null);
  attachBackgroundTaskContext(request, { userId: "user-1", taskId: "task-1" });
  assert.deepEqual(getBackgroundTaskContext(request), { userId: "user-1", taskId: "task-1", usage: null });
  assert.equal(Object.keys(request).some((key) => key.toLowerCase().includes("background")), false);
});

test("sensitive MCP connector tasks are rejected before the existing chat handler is invoked", async () => {
  await assert.rejects(
    invokeTask({ task_type: "chat_response", input_payload: { mcpConnectorIds: ["connector-1"] } }),
    (error) => error.permanent === true && /confirmação individual/.test(error.message),
  );
});

test("unimplemented image, computer, report and generic task types fail explicitly", async () => {
  for (const task_type of ["image_generation", "computer_agent", "report_generation", "other"]) {
    await assert.rejects(
      invokeTask({ task_type, input_payload: {} }),
      (error) => error.permanent === true && typeof error.message === "string" && error.message.length > 0,
      `${task_type} should not remain queued or appear to be supported`,
    );
  }
});
