import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import {
  IMPORT_ONLY_CONNECTION_ATTEMPT,
  installImportOnlyPlaceholderConnectionGuard,
} from "./import-only-placeholder-guard";

describe("import-only placeholder connection guard", () => {
  it("fails before any socket connection can start", () => {
    let attempts = 0;
    const restore = installImportOnlyPlaceholderConnectionGuard(() => {
      attempts += 1;
    });
    try {
      const socket = new Socket();
      expect(() =>
        socket.connect({
          host: "192.0.2.1",
          port: 5432,
        })
      ).toThrow(IMPORT_ONLY_CONNECTION_ATTEMPT);
      expect(attempts).toBe(1);
    } finally {
      restore();
    }
  });
});
