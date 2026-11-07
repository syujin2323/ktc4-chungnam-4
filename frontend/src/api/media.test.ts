import { ApiError } from "@/lib/api-client";

import { uploadContentType, uploadFile } from "./media";

describe("uploadContentType", () => {
  it("아는 확장자는 브라우저가 준 형식과 같은 값을 쓴다", () => {
    expect(uploadContentType({ name: "합성.jpg", type: "image/jpeg" })).toBe("image/jpeg");
  });

  // 기기마다 같은 m4a에 다른 형식을 줍니다. octet-stream은 서버가 거절합니다(#304 4-9).
  it.each(["application/octet-stream", "audio/x-m4a", ""])(
    "m4a는 브라우저가 %s를 줘도 audio/mp4로 보낸다",
    (type) => {
      expect(uploadContentType({ name: "합성.m4a", type })).toBe("audio/mp4");
    },
  );

  // 브라우저가 HEIC 등의 형식을 모르면 file.type이 빈 값이라 서버가 거절합니다(API 문서 §media).
  it.each([
    ["합성.HEIC", "image/heic"],
    ["합성.heif", "image/heic"],
    ["합성.mov", "video/quicktime"],
    ["합성.m4a", "audio/mp4"],
  ])("형식이 빈 값이면 확장자로 채운다: %s", (name, expected) => {
    expect(uploadContentType({ name, type: "" })).toBe(expected);
  });

  it("모르는 확장자는 브라우저가 준 값을 그대로 두어 서버가 사유와 함께 거절하게 한다", () => {
    expect(uploadContentType({ name: "합성.zip", type: "" })).toBe("");
    expect(uploadContentType({ name: "합성.txt", type: "text/plain" })).toBe("text/plain");
  });
});

describe("uploadFile", () => {
  const FILE = new Uint8Array([1, 2, 3]);

  it("그 파일만 거절된 항목은 올리지 않고 서버 사유로 ApiError를 던진다", () => {
    const run = () =>
      uploadFile(
        {
          client_photo_id: "p1",
          status: "error",
          error: { code: "MEDIA_TYPE_NOT_ALLOWED", message: "올릴 수 없는 형식의 파일이에요." },
        },
        FILE,
      );

    expect(run).toThrow(ApiError);
    expect(run).toThrow(
      expect.objectContaining({
        code: "MEDIA_TYPE_NOT_ALLOWED",
        message: "올릴 수 없는 형식의 파일이에요.",
      }),
    );
  });

  it("쓸 수 없는 응답(unknown)은 올리지 않고 멈춘다", () => {
    expect(() => uploadFile({ client_photo_id: "p1", status: "unknown" }, FILE)).toThrow(
      "이 파일의 업로드 URL을 받지 못했어요.",
    );
  });
});
