import { describe, expect, it } from "vitest";
import manifest from "./manifest";

describe("Trainer web app manifest", () => {
  it("publishes the approved install icons", () => {
    expect(manifest()).toMatchObject({
      name: "Trainer",
      short_name: "Trainer",
      start_url: "/",
      display: "standalone",
      icons: [
        {
          src: "/icons/trainer-icon-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/icons/trainer-icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/icons/trainer-icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    });
  });
});
