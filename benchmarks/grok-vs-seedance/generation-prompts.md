# Quantivarian Brief #1 - Generation Prompts (FINAL dialogue, for approval)

Both requests target: **15 s · 9:16 · 720p · native audio · one generation each**.

Final dialogue (identical for both providers):
- Shot 1 [0-3s]: "Worried about your child's exams?"
- Shot 2 [3-7s]: "Quantivarian offers AI tutoring aligned with Nigeria's NERDC curriculum."
- Shot 3 [7-11s]: "From Pre-Nursery to SS3, track their progress."
- Shot 4 [11-15s]: "Help your child achieve more with Quantivarian."

---

## 1. Seedance - `dreamina-seedance-2-5-260628`

### Prompt (single text content - timeline storyboard)
```
A premium 15-second photorealistic commercial for Quantivarian, an AI tutoring app aligned with Nigeria's NERDC curriculum. Sleek luxury aesthetic with warm, vibrant modern Nigerian home tones. A professional Nigerian mother in her early 30s, in sophisticated smart-casual attire, delivers the ad directly to camera. Sunlit modern Lagos living room, bright natural window light mixed with soft interior accents. Natural studio ambience, clear intelligible dialogue, consistent facial identity throughout.

Shot 1 [0-3s, dolly in, 50mm]: The mother looks directly into the lens with empathetic curiosity, leaning slightly forward, in warm morning sunlight. She says: "Worried about your child's exams?" Hard cut.

Shot 2 [3-7s, pan right, 35mm]: The mother turns toward the study desk and gestures at her child studying on a tablet, confident and proud, soft natural key light. She says: "Quantivarian offers AI tutoring aligned with Nigeria's NERDC curriculum." Hard cut.

Shot 3 [7-11s, close-up tracking shift, 85mm]: The mother holds up a smartphone displaying a live progress analytics dashboard, presenting it to camera, reassuring and smiling, clean balanced daylight. She says: "From Pre-Nursery to SS3, track their progress." Hard cut.

Shot 4 [11-15s, slow dolly back, 50mm]: The mother smiles warmly and nods encouragingly directly into the camera, radiant and decisive, bright golden accent light. She says: "Help your child achieve more with Quantivarian." Fade to black.
```

### Request body
```json
{
  "model": "dreamina-seedance-2-5-260628",
  "content": [{ "type": "text", "text": "<prompt above>" }],
  "resolution": "720p",
  "ratio": "9:16",
  "duration": 15,
  "generate_audio": true,
  "watermark": false
}
```
- **Endpoint:** `POST https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks` (then poll task status)
- **Estimated cost:** ≈ $3.47 (24 fps) - $4.33 (30 fps) per video

---

## 2. Grok - `grok-imagine-video-1.5-lite`

### Prompt
```
A 15-second photorealistic commercial for Quantivarian, an AI tutoring app aligned with Nigeria's NERDC curriculum. Sleek luxury aesthetic, warm modern Nigerian home tones, cinematic shallow depth of field. A professional Nigerian mother in her early 30s in sophisticated smart-casual attire speaks directly to the viewer. Sunlit modern Lagos living room, bright natural window light with soft interior accents. Natural studio ambience, clear lip-synced speech, consistent facial identity, no subtitles, no text overlays.

Wide shot, slow dolly in: the mother looks into the lens with warm empathetic curiosity, leaning forward in morning sunlight. She says: "Worried about your child's exams?"

Cut to a pan right: she turns toward her child studying on a tablet at a desk and gestures proudly. She says: "Quantivarian offers AI tutoring aligned with Nigeria's NERDC curriculum."

Cut to a close-up: she holds up a smartphone showing a live progress dashboard, smiling reassuringly. She says: "From Pre-Nursery to SS3, track their progress."

Cut to a slow dolly back: she nods encouragingly into the camera in golden accent light. She says: "Help your child achieve more with Quantivarian."
```

### Request body
```json
{
  "model": "grok-imagine-video-1.5-lite",
  "prompt": "<prompt above>",
  "duration": 15,
  "aspect_ratio": "9:16",
  "resolution": "720p",
  "generate_audio": true
}
```
- **Endpoint:** `POST https://api.x.ai/v1/videos/generations` → poll `GET /v1/videos/{request_id}`
- **Cost:** $0.03/sec × 15 s = **$0.45** per video

---

## Total (2 videos: 1 Grok + 1 Seedance)
**≈ $3.92 - $4.78**

## Quality-check caveats (not guaranteed by either model)
- UI overlays, logo end-card, and exact URL typography (`ng.quantivarian.com`) are **not guaranteed** - evaluated separately.
- Multi-shot adherence (4 cuts, dialogue timing, transitions, consistent identity) is the **unproven variable** this benchmark is testing on both models.
- Seedance cost is a formula estimate; exact figure comes from the task's `completion_tokens`.
