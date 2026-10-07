# React Standards

[Back to CONTRIBUTING.md](../CONTRIBUTING.md)

Load when touching React components or hooks.

- **Server state** (anything fetched from an API) lives in Tanstack Query. **Client UI state** (toggles, open/closed, filters) lives in Zustand or component state. Don't `useState` + `useEffect` to fetch and store server data by hand - that's what Tanstack Query is for.
- **Forms** use React Hook Form with a Zod resolver (`zodResolver(schema)`), giving one source of truth for validation and types (`z.infer<typeof schema>`). Don't hand-roll form state and validation.
- **Function components with hooks only.** No new class components.
