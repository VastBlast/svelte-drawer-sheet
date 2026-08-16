# Maintenance principles

- Keep the library independent, headless, and native to modern Svelte.
- Prefer clear, stable APIs and simple, maintainable code over clever abstractions.
- Preserve accessibility and natural behavior across touch, pointer, keyboard, and assistive input so long it is inexpensive and unless its truly redundant behavior or regresses to the vast majority of users.
- Make optional behavior truly opt-in; defaults must not alter surrounding page presentation.
- Design for composition, nesting, SSR, portals, Shadow DOM, and multiple document contexts.
- Keep interaction and animation work responsive, interruptible, and inexpensive per frame.
- Comment only decisions that are not obvious from the code.
- Ensure code is performant, efficient, high quality, readable with a focus on ux.
