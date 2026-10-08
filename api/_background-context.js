// Trusted in-process context shared only by the queued worker and task-aware handlers.
// Symbols cannot be supplied by an HTTP client as request headers or JSON properties.
const BACKGROUND_TASK_CONTEXT = Symbol.for("kazer.background-task.context.v1");

function attachBackgroundTaskContext(request, context) {
  if (!request || !context?.userId || !context?.taskId) throw new Error("background_context_invalid");
  Object.defineProperty(request, BACKGROUND_TASK_CONTEXT, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      userId: String(context.userId),
      taskId: String(context.taskId),
      usage: context.usage && typeof context.usage === "object" ? context.usage : null,
    }),
  });
  return request;
}

function getBackgroundTaskContext(request) {
  const context = request?.[BACKGROUND_TASK_CONTEXT];
  return context && typeof context.userId === "string" && typeof context.taskId === "string" ? context : null;
}

module.exports = { attachBackgroundTaskContext, getBackgroundTaskContext };
