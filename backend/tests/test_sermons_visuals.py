"""Sermon Studio visuals: AI images (typed or auto prompts, regenerate in place, captions, delete), the planned visual set with
partial failures, and the slide deck plan (content slides, S-05 diagram enrichment, scene images signed on read and reused)."""
from __future__ import annotations

import pytest

from interactive_bible import storage
from interactive_bible.ai.gemini import GeminiError

from . import sermon_fakes as sf
from .fakes import tiny_png
from .support import MEMBER, sql, sql_one

MEDIA_KEYS = {"id", "kind", "prompt", "caption", "order_index", "url", "mime_type", "created_at"}


@pytest.fixture
def ai(fake_llm):
    return sf.install(fake_llm)


@pytest.fixture
def polished(client, login, ai):
    sermon, draft = sf.polished_sermon(client, login(MEMBER))
    return {"sermon": sermon, "draft": draft, "id": sermon["id"], "headers": login(MEMBER)}


def media_key(media_id: str) -> str:
    return sql_one("SELECT storage_key FROM sermon_media WHERE id = :id", id=media_id)["storage_key"]


# ----------------------------------------------------------------------------- single images
def test_generate_image_from_a_prompt(client, polished, ai):
    sid, headers = polished["id"], polished["headers"]
    resp = client.post(f"/v1/sermons/{sid}/media/generate", json={"kind": "map", "prompt": "The road from Jerusalem to Jericho.", "high_quality": True}, headers=headers)
    assert resp.status_code == 200, resp.text
    media = resp.json()["media"]
    assert set(media) == MEDIA_KEYS and media["id"].startswith("med_")
    assert (media["kind"], media["prompt"], media["caption"], media["order_index"], media["mime_type"]) == ("map", "The road from Jerusalem to Jericho.", None, 0, "image/png")
    (prompt, models, aspect, _size) = ai.image_calls[0]
    assert prompt.startswith("The road from Jerusalem to Jericho. Exquisite hand-drawn biblical map") and aspect == "16:9"
    from interactive_bible.config import get_settings

    assert models[0] == get_settings().gemini_image_model_hq  # high quality
    key = media_key(media["id"])
    assert key.startswith(f"sermons/usr_member/{sid}/media/img_") and key.endswith(".png")
    fetched = client.get(media["url"])  # signed URL, no auth needed
    assert fetched.status_code == 200 and fetched.content == tiny_png(prompt) and fetched.headers["content-type"] == "image/png"
    assert client.get(media["url"].replace("sig=", "sig=x")).status_code == 404
    assert client.get(f"/v1/sermons/{sid}", headers=headers).json()["sermon"]["status"] == "multimedia"  # was polished
    second = client.post(f"/v1/sermons/{sid}/media/generate", json={"prompt": "A vineyard"}, headers=headers).json()["media"]
    assert (second["kind"], second["order_index"]) == ("image", 1)
    assert "Masterful cinematic Christian fine-art illustration" in ai.image_calls[1][0] and ai.image_calls[1][1][0] == get_settings().gemini_image_model
    assert sql_one("SELECT run_id, status FROM llm_calls WHERE prompt_id = 'IMG:sermon' LIMIT 1") == {"run_id": sid, "status": "ok"}


def test_image_refused_as_recitation_is_rendered_again_without_lettering(client, polished, ai):
    sid, headers = polished["id"], polished["headers"]
    ai.image_failures.append(GeminiError("the image model returned no image (finishReason=RECITATION)", retryable=True, kind="no_media"))
    resp = client.post(f"/v1/sermons/{sid}/media/generate", json={"kind": "scripture_slide", "prompt": "Romans 8:28 over a calm sunrise sea"}, headers=headers)
    assert resp.status_code == 200, resp.text
    first, second = ai.image_calls[0][0], ai.image_calls[1][0]
    assert "only the Scripture reference" in first and "No text, no letters, no words." not in first
    assert second.startswith("Romans 8:28 over a calm sunrise sea. Scripture slide background") and second.endswith("No text, no letters, no words.")
    assert resp.json()["media"]["kind"] == "scripture_slide" and len(ai.image_calls) == 2
    # other refusals are not retried
    ai.image_failures.append(GeminiError("the image model returned no image (finishReason=IMAGE_SAFETY)", retryable=True, kind="no_media"))
    assert client.post(f"/v1/sermons/{sid}/media/generate", json={"kind": "image", "prompt": "A storm"}, headers=headers).status_code == 503
    assert len(ai.image_calls) == 3


def test_generate_image_with_an_auto_prompt(client, login, polished, ai):
    sid, headers = polished["id"], polished["headers"]
    resp = client.post(f"/v1/sermons/{sid}/media/generate", json={"kind": "scripture_slide", "auto_prompt": True}, headers=headers)
    assert resp.status_code == 200, resp.text
    media = resp.json()["media"]
    assert media["prompt"] == "A gardener tending a vineyard at dawn with golden light over the hills"  # quotes stripped
    call = ai.calls_for("S-06")[0]
    assert "scripture highlight slide featuring a key verse" in call.text and call.section("FOCUS") == "(none)"
    assert call.section("SERMON_EXCERPT").startswith("TITLE: Rooted in the Vine") and "Remain in Christ" in call.section("SERMON_EXCERPT")
    assert ai.image_calls[0][0].startswith(media["prompt"] + ". Breathtaking scripture slide")
    provenance = sql_one("SELECT provenance FROM sermon_media WHERE id = :id", id=media["id"])["provenance"]
    assert provenance["auto_prompt"] is True and provenance["prompt_provenance"]["prompt_id"] == "S-06"
    focused = client.post(f"/v1/sermons/{sid}/media/generate", json={"auto_prompt": True, "prompt": "a lost sheep"}, headers=headers).json()["media"]
    assert "a lost sheep" in focused["prompt"] and ai.calls_for("S-06")[1].section("FOCUS") == "a lost sheep"

    fresh = sf.create_sermon(client, login(MEMBER))
    no_draft = client.post(f"/v1/sermons/{fresh['id']}/media/generate", json={"auto_prompt": True}, headers=headers)
    assert no_draft.status_code == 422 and no_draft.json()["detail"] == "Generate the sermon draft first"
    nothing = client.post(f"/v1/sermons/{sid}/media/generate", json={"kind": "image", "prompt": "  "}, headers=headers)
    assert nothing.status_code == 422
    assert client.post(f"/v1/sermons/{sid}/media/generate", json={"kind": "video", "prompt": "x"}, headers=headers).status_code == 422
    assert len(ai.image_calls) == 2


def test_regenerate_replaces_the_image_in_place(client, polished, ai):
    sid, headers = polished["id"], polished["headers"]
    first = client.post(f"/v1/sermons/{sid}/media/generate", json={"prompt": "A vine"}, headers=headers).json()["media"]
    middle = client.post(f"/v1/sermons/{sid}/media/generate", json={"prompt": "A branch"}, headers=headers).json()["media"]
    client.patch(f"/v1/sermons/{sid}/media/{first['id']}", json={"caption": "The true vine"}, headers=headers)
    old_key = media_key(first["id"])

    resp = client.post(f"/v1/sermons/{sid}/media/generate", json={"prompt": "A vine at sunset", "kind": "graphic", "regenerate_id": first["id"]}, headers=headers)
    assert resp.status_code == 200, resp.text
    again = resp.json()["media"]
    assert (again["id"], again["order_index"], again["kind"], again["prompt"], again["caption"]) == (first["id"], 0, "graphic", "A vine at sunset", "The true vine")
    assert again["url"] != first["url"] and not storage.exists(old_key) and storage.exists(media_key(first["id"]))
    assert client.get(first["url"]).status_code == 404 and client.get(again["url"]).status_code == 200
    listed = client.get(f"/v1/sermons/{sid}", headers=headers).json()["media"]
    assert [(m["id"], m["order_index"]) for m in listed] == [(first["id"], 0), (middle["id"], 1)]

    # a failed regeneration keeps the existing image
    ai.image_failures.append(GeminiError("quota", status=429, kind="quota"))
    failed = client.post(f"/v1/sermons/{sid}/media/generate", json={"prompt": "Another try", "regenerate_id": first["id"]}, headers=headers)
    assert failed.status_code == 503
    assert client.get(again["url"]).status_code == 200 and media_key(first["id"]) == media_key(again["id"])
    missing = client.post(f"/v1/sermons/{sid}/media/generate", json={"prompt": "x", "regenerate_id": "med_missing"}, headers=headers)
    assert missing.status_code == 404 and len(ai.image_calls) == 4  # nothing generated for an unknown image


def test_media_caption_and_delete(client, polished):
    sid, headers = polished["id"], polished["headers"]
    media = client.post(f"/v1/sermons/{sid}/media/generate", json={"prompt": "A vine"}, headers=headers).json()["media"]
    captioned = client.patch(f"/v1/sermons/{sid}/media/{media['id']}", json={"caption": "  The true vine  "}, headers=headers)
    assert captioned.status_code == 200 and captioned.json()["caption"] == "The true vine" and set(captioned.json()) == MEDIA_KEYS
    assert client.patch(f"/v1/sermons/{sid}/media/{media['id']}", json={"caption": ""}, headers=headers).json()["caption"] is None
    assert client.patch(f"/v1/sermons/{sid}/media/{media['id']}", json={"caption": "x" * 301}, headers=headers).status_code == 422
    assert client.patch(f"/v1/sermons/{sid}/media/med_missing", json={"caption": "x"}, headers=headers).status_code == 404
    key = media_key(media["id"])
    assert client.delete(f"/v1/sermons/{sid}/media/{media['id']}", headers=headers).json() == {"ok": True}
    assert not storage.exists(key) and client.get(media["url"]).status_code == 404
    assert client.get(f"/v1/sermons/{sid}", headers=headers).json()["media"] == []
    assert client.delete(f"/v1/sermons/{sid}/media/{media['id']}", headers=headers).status_code == 404


def test_generate_image_without_ai_is_unavailable(client, login, no_llm):
    member = login(MEMBER)
    sermon = sf.create_sermon(client, member)
    resp = client.post(f"/v1/sermons/{sermon['id']}/media/generate", json={"prompt": "A vine"}, headers=member)
    assert resp.status_code == 503 and sf.files_under(f"sermons/usr_member/{sermon['id']}") == []


# ----------------------------------------------------------------------------- visual set
def test_visual_set_follows_the_sermon_outline(client, polished, ai):
    sid, headers = polished["id"], polished["headers"]
    existing = client.post(f"/v1/sermons/{sid}/media/generate", json={"prompt": "A vine"}, headers=headers).json()["media"]
    resp = client.post(f"/v1/sermons/{sid}/media/set", json={"count": 4}, headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert (body["generated"], body["requested"]) == (4, 4)
    assert [(m["kind"], m["caption"], m["order_index"]) for m in body["media"]] == [
        ("image", "Rooted in the Vine", 1), ("scripture_slide", "John 15:1-8", 2), ("image", "Remain in Christ", 3), ("image", "Bear fruit that lasts", 4)]
    assert body["media"][0]["prompt"].startswith('A sweeping establishing scene that captures the heart of a sermon titled "Rooted in the Vine".')
    assert body["media"][1]["prompt"].startswith("A reverent biblical scene evoking this passage: John 15:1-8 — ")
    assert all(p.endswith("No text, no words, no lettering.") for p, *_ in ai.image_calls[1:])
    assert all(client.get(m["url"]).status_code == 200 for m in body["media"])
    listed = client.get(f"/v1/sermons/{sid}", headers=headers).json()["media"]
    assert [m["id"] for m in listed] == [existing["id"]] + [m["id"] for m in body["media"]]

    clamped = client.post(f"/v1/sermons/{sid}/media/set", json={"count": 50}, headers=headers).json()
    assert clamped["requested"] == 5  # cover + scripture + 3 points (count is capped at 8)
    assert client.post(f"/v1/sermons/{sid}/media/set", json={"count": 1}, headers=headers).json()["requested"] == 2
    assert client.post(f"/v1/sermons/{sid}/media/set", headers=headers).json()["requested"] == 5  # default 6, limited by the outline


def test_visual_set_tolerates_partial_failures_but_not_total_failure(client, login, polished, ai):
    sid, headers = polished["id"], polished["headers"]
    ai.image_failures.extend([GeminiError("quota", status=429, kind="quota"), GeminiError("blocked", kind="blocked")])
    partial = client.post(f"/v1/sermons/{sid}/media/set", json={"count": 5}, headers=headers)
    assert partial.status_code == 200, partial.text
    assert (partial.json()["generated"], partial.json()["requested"]) == (3, 5)
    assert [m["order_index"] for m in partial.json()["media"]] == [0, 1, 2]
    assert len(sf.files_under(f"sermons/usr_member/{sid}/media")) == 3

    ai.image_failures.extend([GeminiError("down", kind="error")] * 2)
    total = client.post(f"/v1/sermons/{sid}/media/set", json={"count": 2}, headers=headers)
    assert total.status_code == 502 and "visual set" in total.json()["detail"]
    assert len(client.get(f"/v1/sermons/{sid}", headers=headers).json()["media"]) == 3
    assert len(sf.files_under(f"sermons/usr_member/{sid}/media")) == 3

    fresh = sf.create_sermon(client, login(MEMBER))
    assert client.post(f"/v1/sermons/{fresh['id']}/media/set", json={}, headers=headers).status_code == 422


# ----------------------------------------------------------------------------- slide plan
def scene_slides(plan):
    return [s for s in plan["slides"] if s["visual"]["type"] == "scene"]


def test_slide_plan_builds_content_slides_enrichment_and_scene_images(client, polished, ai):
    sid, headers, draft = polished["id"], polished["headers"], polished["draft"]
    resp = client.post(f"/v1/sermons/{sid}/plan", json={"theme_id": "royal_purple", "target_slide_count": 12}, headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    plan = body["plan"]
    assert plan["meta"] == {"title": "Rooted in the Vine", "theme": "royal_purple", "generatedFor": "content"}
    slides = plan["slides"]
    roles = [s["role"] for s in slides]
    assert slides[0]["layout"] == "cover" and slides[0]["heading"] == "Rooted in the Vine" and slides[0]["reference"] == "John 15:1-8"
    assert slides[-1]["layout"] == "closing" and slides[-1]["role"] == "prayer" and slides[-1]["body"][0] == "Father, keep us rooted in your Son."
    scripture = slides[1]
    assert scripture["role"] == "scripture" and scripture["visual"]["type"] == "scriptureArt"
    assert scripture["visual"]["scripture"]["reference"] == "John 15:1-8" and scripture["visual"]["scripture"]["text"].startswith("I am the true vine")  # surrounding quotes dropped
    # enrichment: a sermon-wide timeline after the opening scripture, a map right after point 1's divider
    assert slides[2]["role"] == "illustration" and slides[2]["layout"] == "timelineSlide" and slides[2]["kicker"] == "Context"
    divider = next(i for i, s in enumerate(slides) if s["role"] == "section")
    assert slides[divider]["heading"] == "Remain in Christ" and slides[divider + 1]["visual"] == {
        "type": "map", "places": [{"name": "Jerusalem", "note": "Temple vine carving"}], "spec": "Where the imagery comes from"}
    assert roles.count("section") == 3 and roles.count("application") == 1 and "Bear fruit that lasts" in [s["heading"] for s in slides]
    point_one = next(s for s in slides if s["role"] == "scripture" and s["heading"] == "John 15:5")
    assert point_one["visual"]["scripture"]["text"] == sf.JOHN_15_5_WEB
    enrich_call = ai.calls_for("S-05")[0]
    assert enrich_call.section("MAIN_POINTS").splitlines() == ["1. Remain in Christ", "2. Bear fruit that lasts", "3. Trust the Gardener"]

    # scene images: one per distinct subject, signed on read, stored as keys
    scenes = scene_slides(plan)
    subjects = {s["visual"]["spec"].lower() for s in scenes}
    assert (body["scenes_requested"], body["scenes_generated"], body["scenes_reused"], body["scenes_failed"]) == (len(subjects), len(subjects), 0, 0)
    assert len(ai.image_calls) == len(subjects) == 7 and len(scenes) == 10  # each point's divider and first teaching slide share a subject
    assert all(s["visual"]["imageKey"].startswith(f"sermons/usr_member/{sid}/plan/scn_") and s["visual"]["imageUrl"] == storage.signed_url(s["visual"]["imageKey"]) for s in scenes)
    cover_prompt = next(p for p, models, *_ in ai.image_calls if p.startswith("A reverent, cinematic fine-art scene evoking Fruitfulness flows from remaining in Christ. No text"))
    assert cover_prompt.endswith("No text, no letters, no words.")  # the scene prompt already forbids text: no style suffix appended
    assert client.get(scenes[0]["visual"]["imageUrl"]).status_code == 200

    stored = sql_one("SELECT slide_plan, provenance FROM sermon_drafts WHERE id = :id", id=draft["id"])
    assert all("imageUrl" not in s["visual"] for s in stored["slide_plan"]["slides"]) and stored["slide_plan"]["slides"][0]["visual"]["imageKey"]
    assert stored["provenance"]["slide_plan"]["enrichment"]["prompt_id"] == "S-05" and len(stored["provenance"]["scene_images"]) == 7
    served = client.get(f"/v1/sermons/{sid}", headers=headers).json()["draft"]
    assert served["slide_plan"] == plan and "scene_images" not in served["provenance"]


def test_slide_plan_reuses_scene_images_on_the_next_design(client, polished, ai):
    sid, headers = polished["id"], polished["headers"]
    first = client.post(f"/v1/sermons/{sid}/plan", json={}, headers=headers).json()
    generated = len(ai.image_calls)
    assert first["plan"]["meta"]["theme"] == "navy_gold" and first["scenes_generated"] == generated
    second = client.post(f"/v1/sermons/{sid}/plan", json={"target_slide_count": 30}, headers=headers).json()
    assert len(ai.image_calls) == generated  # nothing paid twice
    assert (second["scenes_reused"], second["scenes_generated"], second["scenes_failed"]) == (second["scenes_requested"], 0, 0)
    assert {s["visual"]["imageKey"] for s in scene_slides(second["plan"])} == {s["visual"]["imageKey"] for s in scene_slides(first["plan"])}

    # a new point heading needs exactly one new image; the replaced one leaves the deck but stays cached for reuse
    draft = polished["draft"]
    structured = client.get(f"/v1/sermons/{sid}", headers=headers).json()["draft"]["structured"]
    structured["main_points"][2]["heading"] = "Pruned for Growth"
    client.patch(f"/v1/sermons/{sid}/drafts/{draft['id']}", json={"structured": structured}, headers=headers)
    third = client.post(f"/v1/sermons/{sid}/plan", json={}, headers=headers).json()
    assert (third["scenes_generated"], len(ai.image_calls)) == (1, generated + 1)
    assert all(storage.exists(key) for key in sql_one("SELECT provenance FROM sermon_drafts WHERE id = :id", id=draft["id"])["provenance"]["scene_images"].values())

    # changing the format clears the plan, and designing again still reuses the images this draft already has
    client.post(f"/v1/sermons/{sid}/template", json={"draft_id": draft["id"], "template_type": "devotional"}, headers=headers)
    assert client.get(f"/v1/sermons/{sid}", headers=headers).json()["draft"]["slide_plan"] is None
    fourth = client.post(f"/v1/sermons/{sid}/plan", json={}, headers=headers).json()
    assert fourth["scenes_reused"] >= 4  # cover, introduction, conclusion and closing subjects are unchanged
    assert fourth["scenes_generated"] == fourth["scenes_requested"] - fourth["scenes_reused"]


def test_slide_plan_survives_enrichment_and_image_failures(client, login, polished, ai):
    sid, headers = polished["id"], polished["headers"]
    ai.queue("S-05", "not json", "still not json")
    ai.image_failures.extend([GeminiError("quota", status=429, kind="quota")] * 2)
    resp = client.post(f"/v1/sermons/{sid}/plan", json={}, headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "illustration" not in [s["role"] for s in body["plan"]["slides"]]  # the content deck stands on its own
    assert (body["scenes_failed"], body["scenes_generated"]) == (2, body["scenes_requested"] - 2)
    without_image = [s for s in scene_slides(body["plan"]) if "imageKey" not in s["visual"]]
    assert without_image and all("imageUrl" not in s["visual"] for s in without_image)
    stored = sql_one("SELECT provenance FROM sermon_drafts WHERE id = :id", id=polished["draft"]["id"])["provenance"]["slide_plan"]
    assert "invalid JSON twice" in stored["enrichment"]["error"] and stored["scenes_failed"] == 2
    # the failed subjects are generated on the next design; the rest are reused
    retry = client.post(f"/v1/sermons/{sid}/plan", json={}, headers=headers).json()
    assert (retry["scenes_generated"], retry["scenes_reused"], retry["scenes_failed"]) == (2, body["scenes_generated"], 0)

    fresh = sf.create_sermon(client, login(MEMBER))
    no_draft = client.post(f"/v1/sermons/{fresh['id']}/plan", json={}, headers=headers)
    assert no_draft.status_code == 422 and no_draft.json()["detail"] == "Generate the sermon draft first"
    assert client.post(f"/v1/sermons/{sid}/plan", json={"theme_id": "rainbow"}, headers=headers).status_code == 422


def test_slide_plan_scene_budget(client, login, ai):
    member = login(MEMBER)
    sermon = sf.create_sermon(client, member)
    sf.add_text(client, member, sermon["id"])
    ai.on("S-01", lambda call: {**sf.default_s01(call), "main_points": [{"heading": f"Point number {i}", "body": "One sentence.", "scripture": None} for i in range(1, 10)]})
    sf.polish(client, member, sermon["id"])
    body = client.post(f"/v1/sermons/{sermon['id']}/plan", json={}, headers=member).json()
    assert body["scenes_requested"] == 8 and len(ai.image_calls) == 8
    assert sum(1 for s in scene_slides(body["plan"]) if "imageKey" not in s["visual"]) > 0  # later subjects stay text-only


def test_slide_plan_without_ai_still_returns_the_content_deck(client, login, ai):
    member = login(MEMBER)
    sermon, _ = sf.polished_sermon(client, member)
    ai.configured = False  # e.g. the key was removed after drafting
    resp = client.post(f"/v1/sermons/{sermon['id']}/plan", json={}, headers=member)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["plan"]["slides"][0]["layout"] == "cover" and body["scenes_generated"] == 0 and body["scenes_failed"] == body["scenes_requested"] > 0
    assert ai.calls_for("S-05") == [] and ai.image_calls == []
    assert sql("SELECT id FROM sermon_drafts WHERE sermon_id = :s AND slide_plan IS NOT NULL", s=sermon["id"])
