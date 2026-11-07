// 영상·음성 기능이 켜진 큐의 공통 규칙도 유지합니다. 차단 정책은 photo-only.test.ts에서 확인합니다.
vi.mock("@/features/upload-queue/media-capabilities", () => ({ CLIPS_ENABLED: true }));

import {
  hasUnsentWork,
  isImportDone,
  isImportStage,
  mediaKindOf,
  uploadTargets,
  useUploadQueue,
  type LocalMedia,
} from "./upload-queue-store";

function file(name: string) {
  return new File(["x"], name);
}

describe("업로드 큐", () => {
  afterEach(() => useUploadQueue.getState().reset());

  it("서버가 받았거나 교사가 뺀 자료만 남으면 잃을 작업이 없다", () => {
    const queue = useUploadQueue.getState();
    expect(hasUnsentWork(useUploadQueue.getState().items)).toBe(false);

    queue.addFiles([file("IMG_1.jpg"), file("IMG_2.jpg")]);
    const [sent, excluded] = useUploadQueue.getState().items as [LocalMedia, LocalMedia];
    expect(hasUnsentWork(useUploadQueue.getState().items)).toBe(true);

    queue.setUploadState(sent.client_id, "확인됨", "media-1");
    expect(hasUnsentWork(useUploadQueue.getState().items)).toBe(true);

    queue.setReview(excluded.client_id, {
      review_state: "제외",
      assigned_child_ids: [],
      excluded_reason: "기타",
      llm_allowed: false,
    });
    expect(hasUnsentWork(useUploadQueue.getState().items)).toBe(false);
  });

  it("지원하는 형식만 담고, 사진만 분류·검수 상태를 가진다", () => {
    useUploadQueue
      .getState()
      .addFiles([file("IMG_1.HEIC"), file("VID_1.mov"), file("REC_1.m4a"), file("memo.pdf")]);

    const items = useUploadQueue.getState().items;
    expect(items.map((item) => item.kind)).toEqual(["photo", "video", "voice_memo"]);
    expect(items[0]).toMatchObject({ classify_state: "pending", review_state: "미검수" });
    expect(items[1]).not.toHaveProperty("review_state");
    expect(mediaKindOf("memo.pdf")).toBeNull();
  });

  it("형식이 안 맞는 파일은 이름만 한 번 남기고, 제외하거나 비우면 사라진다", () => {
    const queue = useUploadQueue.getState();
    queue.addFiles([file("memo.pdf"), file("a.jpg")]);
    queue.addFiles([file("memo.pdf"), file("notes.zip")]);

    expect(useUploadQueue.getState().rejected).toEqual(["memo.pdf", "notes.zip"]);
    queue.removeRejected("memo.pdf");
    expect(useUploadQueue.getState().rejected).toEqual(["notes.zip"]);
    queue.reset();
    expect(useUploadQueue.getState().rejected).toEqual([]);
  });

  it("불러오기는 세 개씩 진행되고, 전부 100이면 끝난다", () => {
    const queue = useUploadQueue.getState();
    queue.addFiles([file("a.jpg"), file("b.jpg"), file("c.jpg"), file("d.jpg")]);

    queue.advanceImport(100);
    expect(useUploadQueue.getState().items.map((item) => item.import_progress)).toEqual([
      100, 100, 100, 0,
    ]);
    expect(isImportDone(useUploadQueue.getState().items)).toBe(false);

    queue.advanceImport(100);
    expect(isImportDone(useUploadQueue.getState().items)).toBe(true);
  });

  it("분류가 시작됐거나 업로드가 진행된 큐는 불러오기 단계가 아니다", () => {
    const queue = useUploadQueue.getState();
    expect(isImportStage([])).toBe(true);
    queue.addFiles([file("a.jpg"), file("clip.mp4")]);
    expect(isImportStage(useUploadQueue.getState().items)).toBe(true);

    const photo = useUploadQueue.getState().items[0]!;
    queue.setClassification(photo.client_id, {
      model_version: "m1",
      classify_state: "classified",
      candidates: [],
      has_unidentified_face: false,
    });
    expect(isImportStage(useUploadQueue.getState().items)).toBe(false);

    queue.reset();
    queue.addFiles([file("clip.mp4")]);
    queue.setUploadState(useUploadQueue.getState().items[0]!.client_id, "전송중");
    expect(isImportStage(useUploadQueue.getState().items)).toBe(false);
  });

  // frontend/CLAUDE.md §테스트 꼭 있어야 하는 테스트 1번(H-3)
  it("교사가 확정하지 않은 사진은 업로드 목록에 들어가지 않는다", () => {
    const queue = useUploadQueue.getState();
    queue.addFiles([
      file("confirmed.jpg"),
      file("unreviewed.jpg"),
      file("excluded.jpg"),
      file("unclassified.jpg"),
      file("clip.mp4"),
    ]);
    const [confirmed, , excluded, unclassified] = useUploadQueue.getState().items as [
      LocalMedia,
      LocalMedia,
      LocalMedia,
      LocalMedia,
    ];
    queue.setReview(confirmed.client_id, {
      review_state: "확정",
      assigned_child_ids: ["child-1"],
      excluded_reason: null,
      llm_allowed: true,
    });
    queue.setReview(excluded.client_id, {
      review_state: "제외",
      assigned_child_ids: [],
      excluded_reason: "부적절",
      llm_allowed: false,
    });
    queue.setClassification(unclassified.client_id, {
      model_version: "fake-0",
      classify_state: "unclassified",
      candidates: [],
      has_unidentified_face: true,
    });

    const names = uploadTargets(useUploadQueue.getState().items).map((item) => item.file.name);
    expect(names).toEqual(["confirmed.jpg", "clip.mp4"]);
  });
});

// 같은 파일은 이름·크기·수정 시각이 같습니다. 테스트에서는 수정 시각을 고정해 같은 파일을 만듭니다.
function sameFile(name: string) {
  return new File(["x"], name, { lastModified: 1_730_000_000_000 });
}

describe("같은 파일 알아보기 (#304 4-11)", () => {
  afterEach(() => useUploadQueue.getState().reset());

  it("같은 반·날짜에 같은 파일은 큐를 비우고 다시 넣어도 같은 client_id를 받는다", () => {
    const queue = useUploadQueue.getState();
    queue.setRecordDate("2026-11-08");
    queue.addFiles([sameFile("IMG_1.jpg")], "class-1");
    const first = useUploadQueue.getState().items[0]?.client_id;

    // 전송 중에 취소하면 큐를 비웁니다. 같은 파일을 다시 넣어도 서버가 이미 받은 파일로 알아봅니다.
    queue.reset();
    queue.setRecordDate("2026-11-08");
    queue.addFiles([sameFile("IMG_1.jpg")], "class-1");

    expect(first).toBeDefined();
    expect(useUploadQueue.getState().items[0]?.client_id).toBe(first);
  });

  it("반이나 날짜가 다르면 다른 자료로 보고 다른 client_id를 받는다", () => {
    const ids = new Set<string>();
    for (const [classId, date] of [
      ["class-1", "2026-11-08"],
      ["class-2", "2026-11-08"],
      ["class-1", "2026-11-07"],
    ] as const) {
      const queue = useUploadQueue.getState();
      queue.reset();
      queue.setRecordDate(date);
      queue.addFiles([sameFile("IMG_1.jpg")], classId);
      ids.add(useUploadQueue.getState().items[0]?.client_id ?? "");
    }
    expect(ids.size).toBe(3);
  });

  it("같은 파일을 두 번 골라도 한 번만 담는다", () => {
    const queue = useUploadQueue.getState();
    queue.addFiles([sameFile("IMG_1.jpg"), sameFile("IMG_1.jpg")], "class-1");
    queue.addFiles([sameFile("IMG_1.jpg"), sameFile("IMG_2.jpg")], "class-1");

    expect(useUploadQueue.getState().items.map((item) => item.file.name)).toEqual([
      "IMG_1.jpg",
      "IMG_2.jpg",
    ]);
  });
});

describe("올리지 못한 이유 (#304 4-10)", () => {
  afterEach(() => useUploadQueue.getState().reset());

  it("한 항목만 실패로 두고 이유를 남기며, 다시 올리기 시작하면 이유를 지운다", () => {
    const queue = useUploadQueue.getState();
    queue.addFiles([sameFile("REC_1.m4a"), sameFile("REC_2.m4a")], "class-1");
    const [failed, other] = useUploadQueue.getState().items as [LocalMedia, LocalMedia];

    queue.failUpload(failed.client_id, "올릴 수 없는 형식의 파일이에요.");
    expect(useUploadQueue.getState().items.map((item) => item.upload_state)).toEqual([
      "실패",
      "대기",
    ]);
    expect(useUploadQueue.getState().uploadErrors).toEqual({
      [failed.client_id]: "올릴 수 없는 형식의 파일이에요.",
    });
    expect(other.upload_state).toBe("대기");

    queue.setUploadState(failed.client_id, "전송중");
    expect(useUploadQueue.getState().uploadErrors).toEqual({});
  });
});
