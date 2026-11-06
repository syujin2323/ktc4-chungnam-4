import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { documentsKeys } from "@/api/documents";
import { formatTime, kstToday, shiftDate } from "@/lib/datetime";
import { type MediaRecord, updateDb } from "@/mocks/db";
import { fixtureId } from "@/mocks/fixtures/ids";
import { sampleImageUrl } from "@/mocks/fixtures/media";
import { SUNSHINE_CLASS } from "@/mocks/fixtures/organization";
import { apiPath, errorResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoutes } from "@/test/render";
import type { DraftPatchRequest } from "@/types/api-draft/documents";

import { DraftReviewPage } from "../DraftReviewPage";

// 초안 검토 화면에서 '사진 추가'를 누른 뒤의 흐름입니다. 저장 결과가 화면에 바로 보이는지까지 봐야 해서
// 대화상자만 따로 그리지 않고 화면 전체를 그립니다.
// 시드: 어제 김도윤 알림장(draft 12)은 AI 초안처럼 고른 사진이 없고, 그날 사진이 2장(media 41·42) 귀속돼 있습니다.
const YESTERDAY = shiftDate(kstToday(), -1);
const DOYUN = fixtureId("child", 1);
const HAJUN = fixtureId("child", 2);
const YERIN = fixtureId("child", 5); // 시드에 초안이 없다
const DOYUN_NOTE = fixtureId("draft", 12);
const BLOCKS = fixtureId("media", 41);
const SAND = fixtureId("media", 42);
const VIDEO = fixtureId("media", 45);
const BLOCKS_CHECKBOX = `사진 ${formatTime(`${YESTERDAY}T01:10:00Z`)} 고르기`;
const SAND_CHECKBOX = `사진 ${formatTime(`${YESTERDAY}T02:05:00Z`)} 고르기`;
const VIDEO_LABEL = `영상 ${formatTime(`${YESTERDAY}T04:00:00Z`)}`;

function renderPage(childId = DOYUN) {
  return renderRoutes([{ path: "/t/today/review/:childId", element: <DraftReviewPage /> }], {
    initialEntry: `/t/today/review/${childId}?record_date=${YESTERDAY}`,
  });
}

/** 보낸 PATCH 본문을 모읍니다. 응답은 기본 목이 그대로 합니다. */
function capturePatches() {
  const sent: DraftPatchRequest[] = [];
  server.use(
    http.patch(apiPath("/drafts/:draftId"), async ({ request }) => {
      sent.push((await request.clone().json()) as DraftPatchRequest);
    }),
  );
  return sent;
}

function selectOnDoyunNote(mediaIds: string[]) {
  updateDb((db) => {
    const draft = db.drafts[DOYUN_NOTE];
    if (!draft) throw new Error("김도윤 초안이 시드에 없습니다.");
    draft.selected_media_ids = mediaIds;
  });
}

function addMedia(media: Partial<MediaRecord> & { media_id: string }) {
  updateDb((db) => {
    db.media[media.media_id] = {
      client_photo_id: media.media_id,
      class_id: SUNSHINE_CLASS.class_id,
      type: "photo",
      captured_at: `${YESTERDAY}T04:00:00Z`,
      size_bytes: 1,
      llm_allowed: false,
      attributed_at: `${YESTERDAY}T04:00:00Z`,
      child_links: [{ child_id: DOYUN, method: "manual", confidence_score: null }],
      image: 0,
      ...media,
    };
  });
}

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "사진 추가" }));
  return screen.findByRole("dialog", { name: "알림장에 보낼 사진 고르기" });
}

/** 썸네일은 alt=""(장식)이라 역할로 잡히지 않습니다. 대화상자는 포털이라 container에 없습니다. */
function thumbnailUrls(container: HTMLElement) {
  return [...container.querySelectorAll("img")].map((image) => image.getAttribute("src"));
}

describe("초안 검토의 사진 고르기", () => {
  it("고른 순서대로 PATCH하고, 저장하면 선택 사진 수와 썸네일이 바로 바뀐다", async () => {
    const user = userEvent.setup();
    const sent = capturePatches();
    const { container } = renderPage();
    expect(await screen.findByText("선택 사진 0장")).toBeInTheDocument();

    const dialog = await openPicker(user);
    await user.click(await within(dialog).findByRole("checkbox", { name: SAND_CHECKBOX }));
    await user.click(within(dialog).getByRole("checkbox", { name: BLOCKS_CHECKBOX }));
    expect(within(dialog).getByText("2개 골랐어요")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sent).toEqual([{ expected_version: 1, selected_media_ids: [SAND, BLOCKS] }]);
    expect(screen.getByText("선택 사진 2장")).toBeInTheDocument();
    expect(thumbnailUrls(container)).toEqual([sampleImageUrl(1), sampleImageUrl(0)]);
  });

  it("이미 고른 것을 해제해 저장하면 빈 목록을 보내고 썸네일이 사라진다", async () => {
    const user = userEvent.setup();
    selectOnDoyunNote([BLOCKS, SAND]);
    const sent = capturePatches();
    const { container } = renderPage();
    expect(await screen.findByText("선택 사진 2장")).toBeInTheDocument();

    const dialog = await openPicker(user);
    const blocks = await within(dialog).findByRole("checkbox", { name: BLOCKS_CHECKBOX });
    const sand = within(dialog).getByRole("checkbox", { name: SAND_CHECKBOX });
    expect(blocks).toBeChecked();
    expect(sand).toBeChecked();
    await user.click(blocks);
    await user.click(sand);
    await user.click(within(dialog).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sent).toEqual([{ expected_version: 1, selected_media_ids: [] }]);
    expect(screen.getByText("선택 사진 0장")).toBeInTheDocument();
    expect(thumbnailUrls(container)).toEqual([]);
  });

  it("영상은 video로 미리 보고, 고르면 화면에도 영상으로 보이고 따로 센다", async () => {
    const user = userEvent.setup();
    addMedia({ media_id: VIDEO, type: "video" });
    const sent = capturePatches();
    const { container } = renderPage();

    const dialog = await openPicker(user);
    const preview = await within(dialog).findByLabelText(`${VIDEO_LABEL} 미리보기`);
    expect(preview.tagName).toBe("VIDEO");
    expect(preview).toHaveAttribute("controls");
    await user.click(within(dialog).getByRole("checkbox", { name: `${VIDEO_LABEL} 고르기` }));
    await user.click(within(dialog).getByRole("checkbox", { name: BLOCKS_CHECKBOX }));
    await user.click(within(dialog).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sent[0]?.selected_media_ids).toEqual([VIDEO, BLOCKS]);
    expect(screen.getByLabelText("알림장에 고른 영상").tagName).toBe("VIDEO");
    expect(screen.getByText("선택 사진 1장 · 영상 1개")).toBeInTheDocument();
    expect(thumbnailUrls(container)).toEqual([sampleImageUrl(0)]);
  });

  // 후보에서 빠진 사진을 그대로 보내면 서버가 저장 전체를 거절해 교사가 아무것도 고치지 못합니다.
  it("고른 뒤 귀속이 바뀌어 후보에서 빠진 사진은 저장에 싣지 않는다", async () => {
    const user = userEvent.setup();
    const detached = fixtureId("media", 46);
    addMedia({
      media_id: detached,
      child_links: [{ child_id: HAJUN, method: "manual", confidence_score: null }],
    });
    selectOnDoyunNote([detached, BLOCKS]);
    const sent = capturePatches();
    renderPage();
    expect(await screen.findByText("선택 사진 2장")).toBeInTheDocument();

    const dialog = await openPicker(user);
    expect(await within(dialog).findByText("1개 골랐어요")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sent[0]?.selected_media_ids).toEqual([BLOCKS]);
    expect(screen.getByText("선택 사진 1장")).toBeInTheDocument();
  });

  it("바꾼 것이 없으면 저장해도 PATCH를 보내지 않고 확인 체크도 그대로다", async () => {
    const user = userEvent.setup();
    selectOnDoyunNote([BLOCKS]);
    const sent = capturePatches();
    renderPage();
    await screen.findByText("선택 사진 1장");
    await user.click(screen.getByRole("checkbox"));

    const dialog = await openPicker(user);
    await within(dialog).findByText("1개 골랐어요");
    await user.click(within(dialog).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sent).toEqual([]);
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  // reviewed는 최신 본문을 확인했다는 표시입니다. 사진을 바꾼 뒤에는 다시 확인해야 합니다(H-1).
  it("H-1: 사진을 바꾸면 '사진과 본문을 확인했어요' 체크가 풀린다", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("선택 사진 0장");
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "검토 완료하고 승인하기" })).toBeEnabled();

    const dialog = await openPicker(user);
    await user.click(await within(dialog).findByRole("checkbox", { name: BLOCKS_CHECKBOX }));
    await user.click(within(dialog).getByRole("button", { name: "저장" }));

    expect(await screen.findByText("선택 사진 1장")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "사진과 본문을 확인했어요" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "검토 완료하고 승인하기" })).toBeDisabled();
  });

  it("저장에 실패하면 서버 문구를 보여 주고, 고른 것을 그대로 두어 다시 저장할 수 있다", async () => {
    const user = userEvent.setup();
    server.use(
      http.patch(
        apiPath("/drafts/:draftId"),
        () => errorResponse(500, "INTERNAL_ERROR", "잠시 문제가 생겼어요."),
        { once: true },
      ),
    );
    renderPage();

    const dialog = await openPicker(user);
    const blocks = await within(dialog).findByRole("checkbox", { name: BLOCKS_CHECKBOX });
    await user.click(blocks);
    await user.click(within(dialog).getByRole("button", { name: "저장" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("잠시 문제가 생겼어요.");
    expect(blocks).toBeChecked();
    expect(screen.getByText("선택 사진 0장")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("선택 사진 1장")).toBeInTheDocument();
    expect(screen.queryByText("잠시 문제가 생겼어요.")).not.toBeInTheDocument();
  });

  it("그 사이 다른 곳에서 바꿨으면 닫고 이유를 알리며, 새 버전으로 다시 고른다", async () => {
    const user = userEvent.setup();
    const sent = capturePatches();
    renderPage();
    await screen.findByText("선택 사진 0장");

    const dialog = await openPicker(user);
    await user.click(await within(dialog).findByRole("checkbox", { name: BLOCKS_CHECKBOX }));
    updateDb((db) => {
      const draft = db.drafts[DOYUN_NOTE];
      if (!draft) throw new Error("김도윤 초안이 시드에 없습니다.");
      draft.version += 1;
      draft.selected_media_ids = [SAND];
    });
    await user.click(within(dialog).getByRole("button", { name: "저장" }));

    // 다른 곳에서 고른 것을 덮어쓰지 않고, 그쪽 사진을 새로 받아 보여 줍니다.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sent).toEqual([{ expected_version: 1, selected_media_ids: [BLOCKS] }]);
    expect(await screen.findByText("선택 사진 1장")).toBeInTheDocument();
    expect(screen.getByText("다른 곳에서 먼저 고쳤어요. 새로 불러와 주세요.")).toBeInTheDocument();

    const reopened = await openPicker(user);
    expect(screen.queryByText("다른 곳에서 먼저 고쳤어요. 새로 불러와 주세요.")).toBeNull();
    await user.click(await within(reopened).findByRole("checkbox", { name: BLOCKS_CHECKBOX }));
    await user.click(within(reopened).getByRole("button", { name: "저장" }));

    expect(await screen.findByText("선택 사진 2장")).toBeInTheDocument();
    expect(sent[1]).toEqual({ expected_version: 2, selected_media_ids: [SAND, BLOCKS] });
  });

  // 문장 수정과 같습니다. 새 버전을 받았다고 그 버전으로 보내면 다른 곳의 선택을 조용히 덮어씁니다.
  it("열어 둔 사이 초안을 새로 받아도 열 때 본 버전으로 저장하고, 후보는 다시 받지 않는다", async () => {
    const user = userEvent.setup();
    let requests = 0;
    server.use(
      http.get(apiPath("/drafts/:draftId/selectable-media"), () => {
        requests += 1;
      }),
    );
    const sent = capturePatches();
    const { queryClient } = renderPage();
    await screen.findByText("선택 사진 0장");

    const dialog = await openPicker(user);
    await user.click(await within(dialog).findByRole("checkbox", { name: BLOCKS_CHECKBOX }));
    updateDb((db) => {
      const draft = db.drafts[DOYUN_NOTE];
      if (!draft) throw new Error("김도윤 초안이 시드에 없습니다.");
      draft.version += 1;
      draft.selected_media_ids = [SAND];
    });
    await act(() => queryClient.invalidateQueries({ queryKey: documentsKeys.draft(DOYUN_NOTE) }));
    await user.click(within(dialog).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sent[0]?.expected_version).toBe(1);
    expect(screen.getByText("다른 곳에서 먼저 고쳤어요. 새로 불러와 주세요.")).toBeInTheDocument();
    expect(requests).toBe(1);
  });

  it("자료 없는 원아는 타일이 없고, 직접 쓰면 타일이 열려 후보가 없는 이유를 안내한다", async () => {
    const user = userEvent.setup();
    const sent = capturePatches();
    renderPage(YERIN);
    const textbox = await screen.findByRole("textbox", { name: "직접 작성" });
    expect(screen.queryByRole("button", { name: /사진 추가/ })).not.toBeInTheDocument();
    expect(screen.queryByText("준비 중")).not.toBeInTheDocument();

    await user.type(textbox, "오늘은 그림책을 보았어요.");
    await user.click(screen.getByRole("button", { name: "저장하기" }));

    const dialog = await openPicker(user);
    expect(
      await within(dialog).findByText(/이 아이로 분류한 사진·영상이 없어요/),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "저장" })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "닫기" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sent).toEqual([]);
  });

  it("후보를 못 불러오면 실패를 알리고 다시 불러올 수 있다", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(
        apiPath("/drafts/:draftId/selectable-media"),
        () => errorResponse(500, "INTERNAL_ERROR", "사진을 불러오지 못했어요."),
        { once: true },
      ),
    );
    renderPage();

    const dialog = await openPicker(user);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("사진을 불러오지 못했어요.");
    await user.click(within(dialog).getByRole("button", { name: "다시 불러오기" }));

    expect(
      await within(dialog).findByRole("checkbox", { name: BLOCKS_CHECKBOX }),
    ).toBeInTheDocument();
  });

  // 서명 URL이 만료되고 귀속·파기로 후보가 바뀌므로 캐시를 다시 쓰지 않습니다.
  it("닫으면 고르던 것을 버리고, 다시 열 때 후보를 새로 받는다", async () => {
    const user = userEvent.setup();
    let requests = 0;
    server.use(
      http.get(apiPath("/drafts/:draftId/selectable-media"), () => {
        requests += 1;
      }),
    );
    const sent = capturePatches();
    renderPage();

    const dialog = await openPicker(user);
    await user.click(await within(dialog).findByRole("checkbox", { name: BLOCKS_CHECKBOX }));
    await user.click(within(dialog).getByRole("button", { name: "취소" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const reopened = await openPicker(user);

    expect(await within(reopened).findByText("0개 골랐어요")).toBeInTheDocument();
    expect(within(reopened).getByRole("checkbox", { name: BLOCKS_CHECKBOX })).not.toBeChecked();
    expect(requests).toBe(2);
    expect(sent).toEqual([]);
  });

  it("서버가 모르는 종류를 보내면 고를 수 없게 뺀다", async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    server.use(
      http.get(apiPath("/drafts/:draftId/selectable-media"), () =>
        HttpResponse.json({
          items: [
            {
              media_id: BLOCKS,
              type: "hologram",
              url: "https://example.invalid/x",
              url_expires_at: "2099-01-01T00:00:00Z",
              captured_at: `${YESTERDAY}T01:10:00Z`,
            },
          ],
          next_cursor: null,
        }),
      ),
    );
    renderPage();

    const dialog = await openPicker(user);

    expect(await within(dialog).findByText(/사진·영상이 없어요/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
    warn.mockRestore();
  });

  // 서버 PATCH는 검토 대기(verified)인 초안만 받습니다. 눌러서 409를 보게 하지 않습니다.
  it("승인한 초안은 타일을 잠그고 이유를 보여 주며, 다시 검토로 돌리면 열린다", async () => {
    const user = userEvent.setup();
    renderPage(HAJUN); // 시드에서 이하준 알림장은 승인 완료

    const tile = await screen.findByRole("button", { name: /사진 추가/ });
    expect(tile).toBeDisabled();
    expect(tile).toHaveTextContent("다시 검토하기를 누르면 고를 수 있어요");

    await user.click(screen.getByRole("button", { name: "다시 검토하기" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "사진 추가" })).toBeEnabled());
  });

  it("게시한 초안은 타일을 잠그고 바꿀 수 없다고 안내한다", async () => {
    updateDb((db) => {
      const hajun = db.drafts[fixtureId("draft", 22)];
      if (!hajun) throw new Error("이하준 초안이 시드에 없습니다.");
      hajun.published_at = `${YESTERDAY}T08:40:00Z`;
      hajun.include_photos = true;
    });
    renderPage(HAJUN);

    const tile = await screen.findByRole("button", { name: /사진 추가/ });

    expect(tile).toBeDisabled();
    expect(tile).toHaveTextContent("지금은 사진을 바꿀 수 없어요");
  });

  // 사진을 저장하면 버전이 올라, 고치던 문장을 저장할 때 충돌로 사라집니다.
  it("문장을 고치는 중에는 타일을 잠근다", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("선택 사진 0장");

    await user.click(screen.getByRole("button", { name: "직접 수정" }));
    const tile = screen.getByRole("button", { name: /사진 추가/ });
    expect(tile).toBeDisabled();
    expect(tile).toHaveTextContent("수정을 마치면 고를 수 있어요");

    await user.click(screen.getByRole("button", { name: "수정 취소" }));

    expect(screen.getByRole("button", { name: "사진 추가" })).toBeEnabled();
  });

  // 대화상자는 원아 하나의 초안에 딸려 있습니다. 뒤로 가기로 바뀌면 다른 아이 사진을 고르게 됩니다.
  it("다른 원아로 옮기면 대화상자를 닫는다", async () => {
    const user = userEvent.setup();
    const { router } = renderPage();
    await openPicker(user);

    await act(() => router.navigate(`/t/today/review/${HAJUN}?record_date=${YESTERDAY}`));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
