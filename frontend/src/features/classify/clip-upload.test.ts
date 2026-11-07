vi.mock("@/features/upload-queue/media-capabilities", () => ({ CLIPS_ENABLED: true }));
vi.mock("@/api/media", () => ({
  requestUploadUrls: vi.fn(async () => ({ items: [{ status: "issued" }] })),
  uploadFile: vi.fn(async () => {}),
  uploadContentType: (file: File) => file.type,
  completeUpload: vi.fn(async () => ({ media_id: "media" })),
}));

import { completeUpload, requestUploadUrls, uploadFile } from "@/api/media";
import { useUploadQueue } from "@/features/upload-queue/upload-queue-store";
import { startClipUploads } from "./clip-upload";

describe("클립의 활동 날짜", () => {
  afterEach(() => {
    useUploadQueue.getState().reset();
    vi.clearAllMocks();
  });

  it.each(["mp4", "wav"])("다른 날 수정한 %s도 선택한 활동 날짜로 등록한다", async (extension) => {
    useUploadQueue.getState().setRecordDate("2026-10-30");
    useUploadQueue
      .getState()
      .addFiles([
        new File(["x"], `clip.${extension}`, { lastModified: Date.parse("2020-01-01T00:00:00Z") }),
      ]);
    await startClipUploads("class");
    expect(completeUpload).toHaveBeenCalledWith(
      expect.objectContaining({ captured_at: "2026-10-30T03:00:00.000Z" }),
    );
    expect(useUploadQueue.getState().items[0]?.upload_state).toBe("확인됨");
  });

  it("활동 날짜에 수정한 파일은 실제 시각을 그대로 보낸다", async () => {
    useUploadQueue.getState().setRecordDate("2026-10-30");
    useUploadQueue
      .getState()
      .addFiles([
        new File(["x"], "clip.mp4", { lastModified: Date.parse("2026-10-30T01:20:00Z") }),
      ]);
    await startClipUploads("class");
    expect(completeUpload).toHaveBeenCalledWith(
      expect.objectContaining({ captured_at: "2026-10-30T01:20:00.000Z" }),
    );
  });
});

describe("한 파일이 실패할 때 (#304 4-10)", () => {
  afterEach(() => {
    useUploadQueue.getState().reset();
    vi.clearAllMocks();
  });

  function addTwoClips() {
    useUploadQueue
      .getState()
      .addFiles([
        new File(["x"], "first.m4a", { lastModified: 1 }),
        new File(["x"], "second.m4a", { lastModified: 2 }),
      ]);
  }

  it("그 파일만 실패로 두고 이유를 남기며 다음 파일은 올린다", async () => {
    vi.mocked(requestUploadUrls).mockResolvedValueOnce({
      items: [{ status: "issued" }, { status: "issued" }],
    } as unknown as Awaited<ReturnType<typeof requestUploadUrls>>);
    vi.mocked(uploadFile).mockRejectedValueOnce(new Error("올릴 수 없는 형식의 파일이에요."));
    addTwoClips();

    await startClipUploads("class");

    const [first, second] = useUploadQueue.getState().items;
    expect(first?.upload_state).toBe("실패");
    expect(useUploadQueue.getState().uploadErrors[first?.client_id ?? ""]).toBe(
      "올릴 수 없는 형식의 파일이에요.",
    );
    expect(second?.upload_state).toBe("확인됨");
  });

  it("주소를 하나도 받지 못하면 모두 실패로 두고 이유를 남긴다", async () => {
    vi.mocked(requestUploadUrls).mockRejectedValueOnce(new Error("서버에 연결하지 못했어요."));
    addTwoClips();

    await startClipUploads("class");

    expect(useUploadQueue.getState().items.map((item) => item.upload_state)).toEqual([
      "실패",
      "실패",
    ]);
    expect(Object.values(useUploadQueue.getState().uploadErrors)).toEqual([
      "서버에 연결하지 못했어요.",
      "서버에 연결하지 못했어요.",
    ]);
  });
});
