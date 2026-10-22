"use client";

/**
 * Camera and microphone, checked before anybody is waiting.
 *
 * A consultation that opens on "allow camera?" — and then on a denied
 * permission the patient cannot find the setting for — is a consultation that
 * starts ten minutes late with a doctor watching. So the asking happens here,
 * first, with the person's own picture and a level meter that moves when they
 * speak, and the call only starts once something has been seen and heard.
 *
 * This is the browser's own `getUserMedia`, not the video service: it works
 * before a call exists, and it is what grants the permission the call will
 * use. The tracks are stopped when this unmounts, so the camera light goes off
 * before the call takes the camera over.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { Icon } from "@/components/Icon";
import { Button, cx } from "@/components/ui";
import { useTr } from "@/lib/lang";

type Check = "idle" | "asking" | "ready" | "failed";

/** What went wrong, in words a patient can act on. */
function explain(error: unknown, tr: (en: string, ur: string) => string): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return tr(
      "Camera and microphone are blocked for this site. Tap the lock icon beside the address, allow both, then try again.",
      "Is site ke liye camera aur mic band hain. Address ke saath lock ka nishaan dabayein, dono ki ijazat dein, phir dobara koshish karein.",
    );
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return tr(
      "No camera or microphone was found on this device.",
      "Is device par camera ya mic nahi mila.",
    );
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return tr(
      "Another app is using the camera or microphone. Close it and try again.",
      "Koi aur app camera ya mic istemal kar rahi hai. Use band kar ke dobara koshish karein.",
    );
  }
  return tr(
    "The camera or microphone could not be started.",
    "Camera ya mic shuru nahi ho saka.",
  );
}

export function DeviceCheck({
  onReady,
  className,
}: {
  /** Called once something has been seen or heard, with what worked. */
  onReady: (result: { camera: boolean; microphone: boolean }) => void;
  className?: string;
}) {
  const tr = useTr();
  const [check, setCheck] = useState<Check>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [microphone, setMicrophone] = useState(false);
  const [level, setLevel] = useState(0);

  const video = useRef<HTMLVideoElement>(null);
  const media = useRef<MediaStream | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const frame = useRef<number | undefined>(undefined);

  const release = useCallback(() => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    media.current?.getTracks().forEach((track) => track.stop());
    media.current = null;
    void audio.current?.close().catch(() => undefined);
    audio.current = null;
  }, []);

  useEffect(() => release, [release]);

  const listen = (stream: MediaStream) => {
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx || stream.getAudioTracks().length === 0) return;
    const context = new AudioCtx();
    audio.current = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const centred = (sample - 128) / 128;
        sum += centred * centred;
      }
      // RMS, stretched so ordinary speech fills most of the bar.
      setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 4));
      frame.current = requestAnimationFrame(tick);
    };
    tick();
  };

  const start = async () => {
    setCheck("asking");
    setProblem(null);
    release();
    if (!navigator.mediaDevices?.getUserMedia) {
      setCheck("failed");
      setProblem(
        tr(
          "This browser cannot use a camera here. Open the page in Chrome, Safari or Edge.",
          "Yeh browser yahan camera istemal nahi kar sakta. Page Chrome, Safari ya Edge mein kholein.",
        ),
      );
      return;
    }

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (first) {
      // A phone with a broken camera can still have a consultation by voice.
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setProblem(explain(first, tr));
      } catch (second) {
        setCheck("failed");
        setProblem(explain(second, tr));
        return;
      }
    }

    media.current = stream;
    const hasCamera = stream.getVideoTracks().length > 0;
    const hasMic = stream.getAudioTracks().length > 0;
    setCamera(hasCamera);
    setMicrophone(hasMic);
    if (video.current && hasCamera) {
      video.current.srcObject = stream;
      void video.current.play().catch(() => undefined);
    }
    listen(stream);
    setCheck("ready");
  };

  return (
    <div className={cx("space-y-4", className)}>
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-slate-900">
        <video
          ref={video}
          muted
          playsInline
          autoPlay
          aria-label={tr("Your camera", "Aap ka camera")}
          className={cx(
            "h-full w-full -scale-x-100 object-cover transition-opacity duration-300",
            check === "ready" && camera ? "opacity-100" : "opacity-0",
          )}
        />
        {!(check === "ready" && camera) && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-white/80">
            <div>
              <Icon name={check === "failed" ? "videocam_off" : "videocam"} className="text-[40px]" />
              <p className="mt-2 text-sm">
                {check === "asking"
                  ? tr("Waiting for your permission…", "Aap ki ijazat ka intezar…")
                  : check === "ready"
                    ? tr("Camera off — voice only", "Camera band — sirf awaz")
                    : tr("Your camera will appear here", "Aap ka camera yahan nazar aaye ga")}
              </p>
            </div>
          </div>
        )}
        {check === "ready" && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold text-white">
            <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
            {tr("Preview — only you can see this", "Preview — sirf aap dekh sakte hain")}
          </span>
        )}
      </div>

      {check === "ready" && (
        <div className="flex items-center gap-3" aria-live="polite">
          <Icon
            name={microphone ? "mic" : "mic_off"}
            className={cx("text-[22px]", microphone ? "text-primary" : "text-critical")}
          />
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-sunken" aria-hidden>
            <div
              className="bg-gradient-brand h-full rounded-full transition-[width] duration-75"
              style={{ width: `${Math.round(level * 100)}%` }}
            />
          </div>
          <span className="w-28 text-right text-xs text-muted">
            {microphone
              ? level > 0.08
                ? tr("We can hear you", "Aawaz aa rahi hai")
                : tr("Say something…", "Kuchh bolein…")
              : tr("No microphone", "Mic nahi")}
          </span>
        </div>
      )}

      {problem && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-strong"
        >
          <Icon name="info" className="mt-px shrink-0 text-[18px] text-warning" />
          {problem}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {check !== "ready" ? (
          <Button size="lg" loading={check === "asking"} onClick={() => void start()}>
            <Icon name="settings_video_camera" className="text-[22px]" />
            {check === "failed"
              ? tr("Try again", "Dobara koshish karein")
              : tr("Check camera and microphone", "Camera aur mic check karein")}
          </Button>
        ) : (
          <Button
            size="lg"
            onClick={() => {
              const result = { camera, microphone };
              release();
              onReady(result);
            }}
          >
            <Icon name="check" className="text-[22px]" />
            {tr("Looks good", "Sab theek hai")}
          </Button>
        )}
      </div>
    </div>
  );
}
