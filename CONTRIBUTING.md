# Contributing

Small fixes and improvements are welcome. For a large change or a search-algorithm change, open an issue first so we can agree on the approach.

1. Fork the repository and create a branch for your change.
2. Keep the change focused and preserve third-party license notices.
3. With Node 20 or newer, run:

   ```sh
   npm test
   npm run check
   ```

4. Open a pull request explaining the problem, the change, and how you checked it. Include a screenshot for visible UI changes. For engine changes, include a comparison with the current engine under the same search budget.

Keep credentials, browser profiles, and generated research files out of commits. The ignored `work/` and `outputs/` folders are for local files.
