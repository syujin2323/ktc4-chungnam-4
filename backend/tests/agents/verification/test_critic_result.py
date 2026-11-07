import json

from tests.agents.fixtures.evidence import RECORD_DATE
from tools.contracts import DocType, DraftDocument, DraftSentence, VerificationCheckType
from tools.verification.critic_result import parse_critic_response


def _document() -> DraftDocument:
    return DraftDocument(
        doc_type=DocType.OBSERVATION_LOG,
        child_id="child_A",
        record_date=RECORD_DATE,
        sentences=[
            DraftSentence(sentence_id="s1", text="탑을 만들었다", evidence_ids=["ev_001"]),
            DraftSentence(sentence_id="s2", text="양보했다", evidence_ids=["ev_001"]),
        ],
    )


def _note_with_greeting() -> DraftDocument:
    return DraftDocument(
        doc_type=DocType.PARENT_NOTE,
        child_id="child_A",
        record_date=RECORD_DATE,
        sentences=[
            DraftSentence(sentence_id="s1", text="안녕하세요, 어머님!", evidence_ids=[]),
            DraftSentence(sentence_id="s2", text="탑을 만들었어요", evidence_ids=["ev_001"]),
        ],
    )


def _verdict(sentence_id: str, verdict: str, evidence_ids: list[str]) -> dict:
    return {
        "sentence_id": sentence_id,
        "verdict": verdict,
        "reason_code": "ok" if verdict == "pass" else "unsupported_claim",
        "detail": "판정 이유",
        "evidence_ids": evidence_ids,
    }


def test_근거_없는_문장은_빈_근거로_통과할_수_있다():
    raw = json.dumps([_verdict("s1", "pass", []), _verdict("s2", "pass", ["ev_001"])])

    result = parse_critic_response(raw, _note_with_greeting())

    assert result.passed is True


def test_근거_없는_문장에_사실이_담겼다는_판정은_내용_실패다():
    raw = json.dumps([_verdict("s1", "fail", []), _verdict("s2", "pass", ["ev_001"])])

    result = parse_critic_response(raw, _note_with_greeting())

    assert result.passed is False
    assert [(issue.sentence_id, issue.check_type) for issue in result.issues] == [
        ("s1", VerificationCheckType.CRITIC_CONTENT)
    ]


def test_근거_있는_문장을_빈_근거로_통과시키면_응답_오류다():
    raw = json.dumps([_verdict("s1", "pass", []), _verdict("s2", "pass", [])])

    result = parse_critic_response(raw, _note_with_greeting())

    assert result.passed is False
    assert result.issues[0].check_type == VerificationCheckType.CRITIC_RESPONSE_ERROR


def test_모든_문장이_pass면_전체_통과한다():
    raw = json.dumps(
        [
            {
                "sentence_id": "s1",
                "verdict": "pass",
                "reason_code": "ok",
                "detail": "근거 확인",
                "evidence_ids": ["ev_001"],
            },
            {
                "sentence_id": "s2",
                "verdict": "pass",
                "reason_code": "ok",
                "detail": "근거 확인",
                "evidence_ids": ["ev_001"],
            },
        ]
    )

    result = parse_critic_response(raw, _document())

    assert result.passed is True
    assert result.issues == []


def test_문장_하나가_fail이면_전체_실패하고_사유를_담는다():
    raw = json.dumps(
        [
            {
                "sentence_id": "s1",
                "verdict": "pass",
                "reason_code": "ok",
                "detail": "근거 확인",
                "evidence_ids": ["ev_001"],
            },
            {
                "sentence_id": "s2",
                "verdict": "fail",
                "reason_code": "unsupported_claim",
                "detail": "근거에 양보 행동이 없습니다.",
                "evidence_ids": ["ev_001"],
            },
        ]
    )

    result = parse_critic_response(raw, _document())

    assert result.passed is False
    assert result.issues[0].check_type == VerificationCheckType.CRITIC_CONTENT
    assert result.issues[0].sentence_id == "s2"


def test_JSON이_아니면_응답_오류로_처리한다():
    result = parse_critic_response("이건 JSON이 아닙니다", _document())

    assert result.passed is False
    assert result.issues[0].check_type == VerificationCheckType.CRITIC_RESPONSE_ERROR


def _all_pass() -> str:
    return json.dumps(
        [
            {
                "sentence_id": sentence_id,
                "verdict": "pass",
                "reason_code": "ok",
                "detail": "근거 확인",
                "evidence_ids": ["ev_001"],
            }
            for sentence_id in ("s1", "s2")
        ]
    )


def test_코드_블록으로_감싼_응답도_읽는다():
    result = parse_critic_response("```json\n" + _all_pass() + "\n```", _document())

    assert result.passed is True
    assert result.issues == []


def test_코드_블록_밖에_다른_말이_있으면_응답_오류로_처리한다():
    raw = "판정 결과입니다.\n```json\n" + _all_pass() + "\n```"

    result = parse_critic_response(raw, _document())

    assert result.passed is False
    assert result.issues[0].check_type == VerificationCheckType.CRITIC_RESPONSE_ERROR


def test_응답이_비어_있으면_응답_오류로_처리한다():
    result = parse_critic_response(None, _document())

    assert result.passed is False
    assert result.issues[0].check_type == VerificationCheckType.CRITIC_RESPONSE_ERROR


def test_배열이_아니면_응답_오류로_처리한다():
    raw = json.dumps({"sentence_id": "s1", "verdict": "pass"})

    result = parse_critic_response(raw, _document())

    assert result.issues[0].check_type == VerificationCheckType.CRITIC_RESPONSE_ERROR


def test_존재하지_않는_문장을_판정하면_응답_오류로_처리한다():
    raw = json.dumps(
        [
            {"sentence_id": "s1", "verdict": "pass"},
            {"sentence_id": "s2", "verdict": "pass"},
            {"sentence_id": "s99", "verdict": "pass"},
        ]
    )

    result = parse_critic_response(raw, _document())

    assert result.issues[0].check_type == VerificationCheckType.CRITIC_RESPONSE_ERROR


def test_verdict_값이_이상하면_응답_오류로_처리한다():
    raw = json.dumps(
        [
            {"sentence_id": "s1", "verdict": "maybe"},
            {"sentence_id": "s2", "verdict": "pass"},
        ]
    )

    result = parse_critic_response(raw, _document())

    assert result.issues[0].check_type == VerificationCheckType.CRITIC_RESPONSE_ERROR


def test_판정하지_않은_문장이_있으면_응답_오류로_처리한다():
    raw = json.dumps([{"sentence_id": "s1", "verdict": "pass"}])

    result = parse_critic_response(raw, _document())

    assert result.issues[0].check_type == VerificationCheckType.CRITIC_RESPONSE_ERROR


import pytest


@pytest.mark.parametrize(
    "change",
    [
        {"sentence_id": []},
        {"verdict": []},
        {"evidence_ids": ["missing"]},
        {"evidence_ids": "ev_001"},
        {"reason_code": "unknown"},
        {"detail": " "},
    ],
)
def test_잘못된_필드가_예외없이_응답오류가_된다(change):
    entry = {
        "sentence_id": "s1",
        "verdict": "pass",
        "reason_code": "ok",
        "detail": "근거 확인",
        "evidence_ids": ["ev_001"],
    }
    entry.update(change)
    result = parse_critic_response(json.dumps([entry]), _document())
    assert result.issues[0].check_type == VerificationCheckType.CRITIC_RESPONSE_ERROR


def test_중복_판정은_오류():
    entry = {
        "sentence_id": "s1",
        "verdict": "pass",
        "reason_code": "ok",
        "detail": "근거 확인",
        "evidence_ids": ["ev_001"],
    }
    result = parse_critic_response(json.dumps([entry, entry]), _document())
    assert result.issues[0].check_type == VerificationCheckType.CRITIC_RESPONSE_ERROR
