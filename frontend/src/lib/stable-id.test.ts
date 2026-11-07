import { stableUuid } from "./stable-id";

const UUID_V8 = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("stableUuid", () => {
  it("같은 글이면 늘 같은 UUID를 만든다", () => {
    expect(stableUuid("반|2026-11-08|IMG_1.jpg|2048|1730000000000")).toBe(
      stableUuid("반|2026-11-08|IMG_1.jpg|2048|1730000000000"),
    );
  });

  it("한 글자만 달라도 다른 UUID를 만든다", () => {
    const ids = new Set(
      ["a", "b", "IMG_1.jpg", "IMG_2.jpg", "IMG_1.jpg|1", "IMG_1.jpg|2", ""].map(stableUuid),
    );
    expect(ids.size).toBe(7);
  });

  it("서버가 받는 UUID 모양이다", () => {
    for (const key of ["", "합성 사진.jpg", "x".repeat(1000)]) {
      expect(stableUuid(key)).toMatch(UUID_V8);
    }
  });
});
