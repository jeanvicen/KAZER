# Diagrama arquitetural

```text
Interface → InputGuard → Orchestrator → Planner/ContextBuilder/Memory
                                      ↓
                              Router → ToolGuard → Approval
                                      ↓
                             Executor → Sandbox/Adapters
                                      ↓
                         Validation → OutputGuard → Response
```

Diagrama conceitual; os componentes permanecem stubs.
