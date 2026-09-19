#!/usr/bin/env python3
"""Fetch Tier-1 benchmark set from LibriSpeech dev-clean tarball.

Usage: python3 fetch.py /tmp/opencode/bench-dl/dev-clean.tar.gz
Reads the tar sequentially (no full extract), picks 100 utterances
round-robin across speakers, converts to 16kHz mono WAV, writes manifest.jsonl.

Output (repo dir benchmark-audio/):
  wavs/<id>.wav   (git-ignored, ~16MB)
  manifest.jsonl  (tracked: {id, wav, text, speaker, duration_s})
"""
import subprocess
import sys
import tarfile
import wave
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).parent
WAV_DIR = HERE / "wavs"
N_TARGET = 100
PER_SPEAKER = 5
MIN_BYTES, MAX_BYTES = 40_000, 400_000  # ~2-12s FLAC heuristic


def to_wav(flac_bytes: bytes, out: Path) -> float:
    tmp = out.with_suffix(".flac")
    tmp.write_bytes(flac_bytes)
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(tmp),
         "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(out)],
        check=True,
    )
    tmp.unlink()
    with wave.open(str(out), "rb") as w:
        return w.getnframes() / w.getframerate()


def main(tar_path: str) -> None:
    WAV_DIR.mkdir(exist_ok=True)
    texts: dict[str, str] = {}
    flacs: dict[str, tuple[str, int]] = {}  # id -> (member_name, size)

    with tarfile.open(tar_path, "r:gz") as tar:
        for m in tar:
            if m.name.endswith(".trans.txt"):
                f = tar.extractfile(m)
                assert f is not None
                for line in f.read().decode().splitlines():
                    uid, _, text = line.partition(" ")
                    texts[uid.strip()] = text.strip()
            elif m.name.endswith(".flac") and MIN_BYTES <= m.size <= MAX_BYTES:
                uid = Path(m.name).stem
                if uid not in flacs:
                    flacs[uid] = (m.name, m.size)

    by_speaker: dict[str, list[str]] = defaultdict(list)
    for uid in flacs:
        if uid in texts and len(texts[uid]) > 10:
            by_speaker[uid.split("-")[0]].append(uid)
    for uids in by_speaker.values():
        uids.sort()

    # round-robin across speakers for diversity
    picked: list[str] = []
    speakers = sorted(by_speaker)
    counts: dict[str, int] = defaultdict(int)
    while len(picked) < N_TARGET:
        progressed = False
        for spk in speakers:
            cand = [u for u in by_speaker[spk]
                    if u not in picked and counts[spk] < PER_SPEAKER]
            if cand:
                # mid-size first: closest to ~150KB ≈ 5s
                cand.sort(key=lambda u: abs(flacs[u][1] - 150_000))
                picked.append(cand[0])
                counts[spk] += 1
                progressed = True
                if len(picked) >= N_TARGET:
                    break
        if not progressed:
            break

    with tarfile.open(tar_path, "r:gz") as tar:
        members = {flacs[u][0]: u for u in picked}
        rows = []
        for m in tar:
            if m.name in members:
                f = tar.extractfile(m)
                assert f is not None
                uid = members[m.name]
                dur = to_wav(f.read(), WAV_DIR / f"{uid}.wav")
                if 2.0 <= dur <= 15.0:
                    rows.append({
                        "id": uid,
                        "wav": f"wavs/{uid}.wav",
                        "text": texts[uid],
                        "speaker": uid.split("-")[0],
                        "duration_s": round(dur, 2),
                    })
                else:
                    (WAV_DIR / f"{uid}.wav").unlink(missing_ok=True)

    rows.sort(key=lambda r: r["id"])
    with open(HERE / "manifest.jsonl", "w") as f:
        for r in rows:
            f.write(__import__("json").dumps(r) + "\n")
    n_spk = len({r["speaker"] for r in rows})
    tot = sum(r["duration_s"] for r in rows)
    print(f"wrote {len(rows)} utterances, {n_spk} speakers, {tot/60:.1f} min audio")


if __name__ == "__main__":
    main(sys.argv[1])
