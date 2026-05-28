# Task 1.7 Rejection Evidence

- POST /agent-bindings without modelConfigId for runtime.kind = native returns 400 { error: "native_runtime_requires_model_config" }.
- DELETE /agent-bindings/:id with matching room_participants returns 409 and does not emit a binding event.
