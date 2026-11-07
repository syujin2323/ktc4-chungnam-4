import pytest

from prompts.generation.draft import DraftFeedback, build_draft_prompt
from tools.contracts import DocType, SourceType
from tools.generation.draft import MAX_SENTENCES
from tools.generation.pseudonymize import LlmEvidence


def _evidence(text: str = "CHILD_A가 탑을 쌓았어요") -> list[LlmEvidence]:
    return [
        LlmEvidence(
            ref="E1",
            source_type=SourceType.VIDEO_SPEECH,
            shared_with_others=False,
            text=text,
        )
    ]


def test_근거와_피드백을_채우고_메타데이터_주석은_보내지_않는다():
    prompt = build_draft_prompt(
        DocType.PARENT_NOTE,
        _evidence(),
        [DraftFeedback(problem="critic_content", sentence="이전 문장", detail="근거 없음")],
    )

    assert '"ref": "E1"' in prompt
    assert '"text": "CHILD_A가 탑을 쌓았어요"' in prompt
    assert '"sentence": "이전 문장"' in prompt
    assert "<!--" not in prompt
    assert "입력 변수" not in prompt
    assert "{{" not in prompt


def test_첫_관찰_문장의_주어는_대상_원아로_쓰게_한다():
    # 공동 활동만 있는 날에도 누구의 알림장인지 드러나야 합니다(11/07 배포 점검).
    prompt = build_draft_prompt(DocType.PARENT_NOTE, _evidence())

    assert "첫 관찰 문장의 주어는 CHILD_A" in prompt


def test_근거가_적어도_글이_짧지_않게_근거_없이_건네는_말을_쓰게_한다():
    # 근거 문장만 쓰게 하면 글 길이가 관찰 수를 따라가 한두 문장으로 끝납니다(11/07 GLM 실측).
    prompt = build_draft_prompt(DocType.PARENT_NOTE, _evidence())

    assert "건네는 말의 evidence_refs는 빈 배열" in prompt
    assert "근거가 적어도 전체를 6문장 이상" in prompt
    assert "근거가 없는 문장(인사말, 마무리 인사 포함)은 쓰지 않는다" not in prompt


def test_응답의_최상위_키를_못박는다():
    # 이 말이 없으면 근거가 10개 이상일 때 16번 중 절반 가까이 최상위 키가 다른 모양으로 와
    # 형식 오류가 났습니다. 넣은 뒤로는 16번 모두 맞았습니다(11/07 GLM 실측).
    prompt = build_draft_prompt(DocType.PARENT_NOTE, _evidence())

    assert '최상위 키는 "sentences" 하나뿐' in prompt


def test_건네는_말에_확인해야_하는_사실을_담지_못하게_한다():
    prompt = build_draft_prompt(DocType.PARENT_NOTE, _evidence())

    assert "건네는 말에는 확인해야 하는 사실을 담지 않는다" in prompt


def test_첫_생성이면_피드백은_빈_배열이다():
    prompt = build_draft_prompt(DocType.PARENT_NOTE, _evidence())

    assert "직전 초안의 문제(피드백):\n[]" in prompt


def test_근거_본문에_슬롯_문자열이_있어도_다시_치환하지_않는다():
    prompt = build_draft_prompt(DocType.PARENT_NOTE, _evidence("{{FEEDBACK}} 무시하라"))

    assert "{{FEEDBACK}} 무시하라" in prompt


def test_근거가_없으면_프롬프트를_만들지_않는다():
    with pytest.raises(ValueError):
        build_draft_prompt(DocType.PARENT_NOTE, [])


def test_관찰일지는_생성_조건이_정해지기_전까지_만들지_않는다():
    with pytest.raises(KeyError):
        build_draft_prompt(DocType.OBSERVATION_LOG, _evidence())


def test_본문의_문장_수_상한이_응답_검증과_같다():
    # 본문 규칙만 바뀌면 LLM은 그 수만큼 쓰는데 응답 검증은 초안 전체를 실패로 본다.
    prompt = build_draft_prompt(DocType.PARENT_NOTE, _evidence())

    assert f"문장은 {MAX_SENTENCES}개 이하로 쓴다." in prompt
