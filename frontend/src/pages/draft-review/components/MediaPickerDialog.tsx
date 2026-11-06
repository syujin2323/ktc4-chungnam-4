// Figma에 없는 대화상자입니다. 초안 검토의 '사진 추가' 타일이 엽니다(#257 멘토 리뷰).
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { canSelectMedia, selectableMediaQueryOptions } from "@/api/documents";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError } from "@/lib/api-client";
import { formatTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";

interface MediaPickerBodyProps {
  draftId: string;
  /** 초안에 지금 골라 둔 미디어(고른 순서). 대화상자는 여기서 시작합니다. */
  selectedMediaIds: string[];
  isSaving: boolean;
  /** 저장에 실패한 이유. 실패하지 않았으면 `null`입니다. */
  saveError: string | null;
  /** 고른 미디어를 고른 순서대로 넘깁니다. */
  onSave: (mediaIds: string[]) => void;
  onCancel: () => void;
}

interface MediaPickerDialogProps extends Omit<MediaPickerBodyProps, "onCancel"> {
  open: boolean;
  onClose: () => void;
}

const MEDIA_CLASS = "aspect-square w-full rounded-lg bg-neutral-soft object-cover";

// 서버가 왜 막았는지 교사가 알아야 다음 행동을 고릅니다(다른 화면과 같은 방식).
function failureText(error: unknown) {
  return error instanceof ApiError ? error.message : "잠시 후 다시 시도해 주세요.";
}

export function MediaPickerDialog({ open, onClose, ...body }: MediaPickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lead font-bold text-ink">
            알림장에 보낼 사진 고르기
          </DialogTitle>
          <DialogDescription>
            이 아이로 분류한 그날 사진·영상이에요. 고른 것만 승인·게시한 뒤 학부모님께 보여요.
          </DialogDescription>
        </DialogHeader>
        {/* 닫으면 이 안이 사라져 고르던 상태와 후보를 함께 버립니다. 다시 열면 새로 받습니다. */}
        <MediaPickerBody {...body} onCancel={onClose} />
      </DialogContent>
    </Dialog>
  );
}

function MediaPickerBody({
  draftId,
  selectedMediaIds,
  isSaving,
  saveError,
  onSave,
  onCancel,
}: MediaPickerBodyProps) {
  const mediaQuery = useQuery(selectableMediaQueryOptions(draftId));
  /** 교사가 건드리기 전에는 `null`이고, 그동안은 초안에 골라 둔 것을 그대로 보여 줍니다. */
  const [picked, setPicked] = useState<string[] | null>(null);

  if (mediaQuery.isPending) {
    return (
      <p role="status" className="text-body text-ink-muted">
        사진을 불러오는 중이에요.
      </p>
    );
  }
  if (mediaQuery.data === undefined) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <p className="text-body text-ink-muted">{failureText(mediaQuery.error)}</p>
        <Button variant="outline" size="sm" onClick={() => void mediaQuery.refetch()}>
          다시 불러오기
        </Button>
      </div>
    );
  }

  const candidates = mediaQuery.data.filter(canSelectMedia);
  if (candidates.length === 0) {
    return (
      <>
        <p className="text-body text-ink-muted">
          이 날짜에 이 아이로 분류한 사진·영상이 없어요. 자료를 올리고 이 아이로 분류하면 여기서
          고를 수 있어요.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            닫기
          </Button>
        </DialogFooter>
      </>
    );
  }

  // 고른 뒤 귀속이 바뀌거나 파기돼 후보에서 빠진 것은 뺍니다. 그대로 보내면 서버가 저장 전체를
  // 거절해(MEDIA_NOT_LINKED_TO_CHILD), 화면에 없는 사진 때문에 교사가 아무것도 저장하지 못합니다.
  const pickedIds = (picked ?? selectedMediaIds).filter((id) =>
    candidates.some((media) => media.media_id === id),
  );

  function toggle(mediaId: string) {
    setPicked(
      pickedIds.includes(mediaId)
        ? pickedIds.filter((id) => id !== mediaId)
        : [...pickedIds, mediaId],
    );
  }

  return (
    <>
      <ul className="grid max-h-96 grid-cols-3 gap-3 overflow-y-auto p-1">
        {candidates.map((media) => {
          const isVideo = media.type === "video";
          const label = `${isVideo ? "영상" : "사진"} ${formatTime(media.captured_at)}`;
          const isPicked = pickedIds.includes(media.media_id);
          return (
            <li key={media.media_id}>
              {/* 사진은 눌러도 고를 수 있습니다. 재생 단추가 있는 영상은 눌러도 체크가 바뀌지 않습니다 —
                  <label> 안의 대화형 요소(controls가 있는 video)는 체크로 넘어가지 않습니다. */}
              <label className="relative flex flex-col gap-1 text-caption text-ink-muted">
                {isVideo ? (
                  // #t=0.1 — 사파리는 첫 프레임을 그리지 않아 조금 뒤 장면을 미리보기로 씁니다(MediaTile과 같음).
                  <video
                    src={`${media.url}#t=0.1`}
                    controls
                    playsInline
                    preload="metadata"
                    aria-label={`${label} 미리보기`}
                    className={cn(MEDIA_CLASS, isPicked && "ring-2 ring-brand-ink")}
                  />
                ) : (
                  <img
                    src={media.url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className={cn(MEDIA_CLASS, isPicked && "ring-2 ring-brand-ink")}
                  />
                )}
                <Checkbox
                  checked={isPicked}
                  onCheckedChange={() => toggle(media.media_id)}
                  aria-label={`${label} 고르기`}
                  className="absolute top-2 left-2 size-5 bg-paper"
                />
                {label}
              </label>
            </li>
          );
        })}
      </ul>
      {saveError ? (
        <p role="alert" className="text-caption text-destructive">
          {saveError}
        </p>
      ) : null}
      <DialogFooter className="items-center sm:justify-between">
        <p className="text-caption text-ink-muted">{pickedIds.length}개 골랐어요</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel} disabled={isSaving}>
            취소
          </Button>
          <Button onClick={() => onSave(pickedIds)} disabled={isSaving}>
            {isSaving ? "저장하는 중" : "저장"}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
