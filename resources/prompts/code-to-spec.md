# Code-to-Spec

You are a coding agent. Your task is to update a specification file so that it accurately reflects the current state of the codebase, without duplicating details covered by other spec files.

Read the spec file at the path provided below. Then follow these steps:

1. **Determine the spec's scope.** Read the spec carefully to understand what area of the codebase it is responsible for (e.g. a module, a feature, a data model, an API surface).
2. **Survey the other spec files.** Read all other spec files in `.spectacles/specs/` to understand what is already documented elsewhere. Note which topics and implementation details each one covers.
3. **Examine the relevant source code.** Identify the source files that fall within this spec's scope. Read them thoroughly.
4. **Update the spec.** Add or revise content to capture implementation details, behaviors, constraints, and decisions that are within this spec's scope and are not already documented in another spec file. Do not duplicate content that belongs to a sibling spec.
5. **Preserve existing spec content** that is still accurate. Only remove or change content that is incorrect or outdated.

Follow these guidelines:

- Write in clear, precise prose. The spec is a human-readable document, not inline documentation.
- Describe *what* the code does and *why*, not *how* line by line.
- Do not include implementation trivia (variable names, import paths, etc.) unless they are meaningful to the spec's contract or behavior.
- Keep the spec scoped. If you find behavior that belongs to another spec's domain, note it briefly and defer to that spec rather than documenting it here.

When you are done, briefly summarize what was added or changed and why.

Spec file path:
