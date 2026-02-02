export interface AudioTrack {
    path: string;
    name: string;
}

const AUDIO_ENQUEUE_EVENT = "opencowork:audio-enqueue";

export const enqueueAudio = (track: AudioTrack) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent<AudioTrack>(AUDIO_ENQUEUE_EVENT, { detail: track }));
};

export const onAudioEnqueue = (handler: (track: AudioTrack) => void) => {
    if (typeof window === "undefined") return () => {};

    const listener = (event: Event) => {
        const custom = event as CustomEvent<AudioTrack>;
        if (!custom.detail?.path) return;
        handler(custom.detail);
    };

    window.addEventListener(AUDIO_ENQUEUE_EVENT, listener as EventListener);
    return () => window.removeEventListener(AUDIO_ENQUEUE_EVENT, listener as EventListener);
};
