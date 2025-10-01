import "@testing-library/jest-dom";

// Any global mocks go here, for example:
globalThis.fetch =
  globalThis.fetch ??
  (() => {
    throw new Error("fetch is not available in tests — mock it!");
  });
