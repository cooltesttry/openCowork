"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ListMusic, Pause, Play, Repeat, Shuffle, SkipBack, SkipForward, Trash2, X } from "lucide-react";

import { AudioTrack, onAudioEnqueue } from "@/lib/audio-player";

const BASE_SIZE = 40;
const CONTROL_SIZE = 28;
const CONTROL_GAP = 6;

const buildTrackUrl = (path: string) => {
    return `http://localhost:8000/api/files/raw?path=${encodeURIComponent(path)}`;
};

const WaveBars = ({ active }: { active: boolean }) => {
    return (
        <div className="flex h-full w-full items-center justify-center">
            <div className="flex items-end justify-center gap-0.5">
                <span className={`block w-1 rounded-full bg-current ${active ? "audio-wave-1" : ""}`} style={{ height: 6 }} />
                <span className={`block w-1 rounded-full bg-current ${active ? "audio-wave-2" : ""}`} style={{ height: 10 }} />
                <span className={`block w-1 rounded-full bg-current ${active ? "audio-wave-3" : ""}`} style={{ height: 7 }} />
            </div>
            <style jsx>{`
                @keyframes audioWaveOne {
                    0% { transform: scaleY(0.6); }
                    50% { transform: scaleY(1.2); }
                    100% { transform: scaleY(0.6); }
                }
                @keyframes audioWaveTwo {
                    0% { transform: scaleY(0.9); }
                    50% { transform: scaleY(0.5); }
                    100% { transform: scaleY(0.9); }
                }
                @keyframes audioWaveThree {
                    0% { transform: scaleY(0.7); }
                    50% { transform: scaleY(1.1); }
                    100% { transform: scaleY(0.7); }
                }
                .audio-wave-1 {
                    animation: audioWaveOne 0.9s ease-in-out infinite;
                }
                .audio-wave-2 {
                    animation: audioWaveTwo 0.9s ease-in-out infinite;
                }
                .audio-wave-3 {
                    animation: audioWaveThree 0.9s ease-in-out infinite;
                }
            `}</style>
        </div>
    );
};

export function FloatingAudioPlayer() {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [queue, setQueue] = useState<AudioTrack[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isHover, setIsHover] = useState(false);
    const [showPlaylist, setShowPlaylist] = useState(false);
    const [isShuffle, setIsShuffle] = useState(false);
    const [isLoop, setIsLoop] = useState(false);

    const queueRef = useRef(queue);
    const currentIndexRef = useRef(currentIndex);
    const shuffleRef = useRef(isShuffle);
    const loopRef = useRef(isLoop);

    useEffect(() => {
        queueRef.current = queue;
    }, [queue]);

    useEffect(() => {
        currentIndexRef.current = currentIndex;
    }, [currentIndex]);

    useEffect(() => {
        shuffleRef.current = isShuffle;
    }, [isShuffle]);

    useEffect(() => {
        loopRef.current = isLoop;
    }, [isLoop]);

    useEffect(() => {
        const audio = new Audio();
        audioRef.current = audio;

        const onEnded = () => {
            const list = queueRef.current;
            if (!list.length) return;

            const idx = currentIndexRef.current;
            const hasNext = idx < list.length - 1;
            const canContinue = loopRef.current || hasNext;
            if (!canContinue) {
                setIsPlaying(false);
                setQueue([]);
                return;
            }

            let nextIndex = idx + 1;
            if (shuffleRef.current && list.length > 1) {
                do {
                    nextIndex = Math.floor(Math.random() * list.length);
                } while (nextIndex === idx);
            } else if (nextIndex >= list.length) {
                nextIndex = 0;
            }

            setCurrentIndex(nextIndex);
            setIsPlaying(true);
        };

        audio.addEventListener("ended", onEnded);

        return () => {
            audio.pause();
            audio.src = "";
            audio.removeEventListener("ended", onEnded);
            audioRef.current = null;
        };
    }, []);

    useEffect(() => {
        return onAudioEnqueue((track) => {
            setQueue((prev) => {
                const next = [...prev, track];
                if (prev.length === 0) {
                    setCurrentIndex(0);
                    setIsPlaying(true);
                }
                return next;
            });
        });
    }, []);

    useEffect(() => {
        const audio = audioRef.current;
        const current = queue[currentIndex];
        if (!audio) return;

        if (!current) {
            audio.pause();
            audio.src = "";
            return;
        }

        audio.src = buildTrackUrl(current.path);
        audio.load();
        if (isPlaying) {
            audio.play().catch(() => setIsPlaying(false));
        }
    }, [queue, currentIndex]);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        if (isPlaying) {
            audio.play().catch(() => setIsPlaying(false));
        } else {
            audio.pause();
        }
    }, [isPlaying]);

    const currentTrack = queue[currentIndex];
    const showPrevNext = queue.length > 1;
    const controlsCount = (showPrevNext ? 2 : 0) + 2; // close + playlist
    const expandedWidth = BASE_SIZE + controlsCount * (CONTROL_SIZE + CONTROL_GAP);
    const isExpanded = isHover || showPlaylist;

    const handlePlayPause = () => {
        if (!audioRef.current) return;
        if (isPlaying) {
            audioRef.current.pause();
            setIsPlaying(false);
        } else {
            audioRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
        }
    };

    const handleClose = () => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = "";
        }
        setQueue([]);
        setCurrentIndex(0);
        setIsPlaying(false);
        setShowPlaylist(false);
    };

    const handlePrev = () => {
        if (!queue.length) return;
        let nextIndex = currentIndex - 1;
        if (nextIndex < 0) {
            nextIndex = isLoop ? queue.length - 1 : 0;
        }
        setCurrentIndex(nextIndex);
        setIsPlaying(true);
    };

    const handleNext = () => {
        if (!queue.length) return;
        let nextIndex = currentIndex + 1;
        if (nextIndex >= queue.length) {
            nextIndex = isLoop ? 0 : queue.length - 1;
        }
        setCurrentIndex(nextIndex);
        setIsPlaying(true);
    };

    const handleSelectTrack = (index: number) => {
        setCurrentIndex(index);
        setIsPlaying(true);
    };

    const handleRemoveTrack = (index: number) => {
        setQueue((prev) => {
            const next = prev.filter((_, idx) => idx !== index);
            if (!next.length) {
                setCurrentIndex(0);
                setIsPlaying(false);
                return next;
            }

            if (index < currentIndex) {
                setCurrentIndex(currentIndex - 1);
            } else if (index === currentIndex) {
                const newIndex = Math.min(index, next.length - 1);
                setCurrentIndex(newIndex);
                setIsPlaying(true);
            }

            return next;
        });
    };

    const moveTrack = (from: number, to: number) => {
        if (to < 0 || to >= queue.length) return;
        setQueue((prev) => {
            const next = [...prev];
            const [item] = next.splice(from, 1);
            next.splice(to, 0, item);

            if (from === currentIndex) {
                setCurrentIndex(to);
            } else if (from < currentIndex && to >= currentIndex) {
                setCurrentIndex(currentIndex - 1);
            } else if (from > currentIndex && to <= currentIndex) {
                setCurrentIndex(currentIndex + 1);
            }

            return next;
        });
    };

    const playlistControls = useMemo(() => {
        return (
            <div className="flex items-center gap-2">
                <button
                    className={`h-7 w-7 rounded-full border text-xs ${isShuffle ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
                    onClick={() => setIsShuffle((prev) => !prev)}
                    title="Shuffle"
                >
                    <Shuffle className="h-3.5 w-3.5 mx-auto" />
                </button>
                <button
                    className={`h-7 w-7 rounded-full border text-xs ${isLoop ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
                    onClick={() => setIsLoop((prev) => !prev)}
                    title="Loop"
                >
                    <Repeat className="h-3.5 w-3.5 mx-auto" />
                </button>
            </div>
        );
    }, [isShuffle, isLoop]);

    if (!queue.length) {
        return null;
    }

    return (
        <div
            className="fixed bottom-4 right-4 z-50"
            onMouseEnter={() => setIsHover(true)}
            onMouseLeave={() => setIsHover(false)}
        >
            <div className="relative">
                {showPlaylist && (
                    <div className="absolute bottom-full right-0 mb-3 w-72 rounded-xl border border-border bg-card/95 p-3 shadow-xl">
                        <div className="flex items-center justify-between pb-2">
                            <div className="text-xs font-medium text-muted-foreground">Playlist ({queue.length})</div>
                            {playlistControls}
                        </div>
                        <div className="max-h-56 overflow-auto">
                            {queue.map((track, index) => (
                                <div
                                    key={`${track.path}-${index}`}
                                    className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs ${index === currentIndex ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent/40"}`}
                                >
                                    <button
                                        className="flex-1 truncate text-left"
                                        onClick={() => handleSelectTrack(index)}
                                    >
                                        {track.name}
                                    </button>
                                    <button
                                        className="h-6 w-6 rounded-md border border-border text-muted-foreground hover:text-foreground"
                                        onClick={() => moveTrack(index, index - 1)}
                                        title="Move up"
                                    >
                                        <ArrowUp className="h-3.5 w-3.5 mx-auto" />
                                    </button>
                                    <button
                                        className="h-6 w-6 rounded-md border border-border text-muted-foreground hover:text-foreground"
                                        onClick={() => moveTrack(index, index + 1)}
                                        title="Move down"
                                    >
                                        <ArrowDown className="h-3.5 w-3.5 mx-auto" />
                                    </button>
                                    <button
                                        className="h-6 w-6 rounded-md border border-border text-muted-foreground hover:text-destructive"
                                        onClick={() => handleRemoveTrack(index)}
                                        title="Remove"
                                    >
                                        <Trash2 className="h-3.5 w-3.5 mx-auto" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                <div
                    className="overflow-hidden rounded-full border border-border bg-card/90 shadow-lg transition-[width] duration-200 ease-out"
                    style={{ width: isExpanded ? expandedWidth : BASE_SIZE, height: BASE_SIZE }}
                >
                    <div className="flex h-full items-center justify-end gap-1.5">
                        <div className={`flex items-center gap-1.5 transition-opacity ${isExpanded ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
                            <button
                                className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                                onClick={handleClose}
                                title="Close"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                            {showPrevNext && (
                                <button
                                    className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                                    onClick={handlePrev}
                                    title="Previous"
                                >
                                    <SkipBack className="h-3.5 w-3.5" />
                                </button>
                            )}
                            {showPrevNext && (
                                <button
                                    className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                                    onClick={handleNext}
                                    title="Next"
                                >
                                    <SkipForward className="h-3.5 w-3.5" />
                                </button>
                            )}
                            <button
                                className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                                onClick={() => setShowPlaylist((prev) => !prev)}
                                title="Playlist"
                            >
                                <ListMusic className="h-3.5 w-3.5" />
                            </button>
                        </div>
                        <button
                            className="flex h-10 w-10 items-center justify-center rounded-full text-foreground"
                            onClick={handlePlayPause}
                            title={isPlaying ? "Pause" : "Play"}
                        >
                            {isExpanded ? (
                                isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />
                            ) : (
                                <WaveBars active={isPlaying} />
                            )}
                        </button>
                    </div>
                </div>
                {currentTrack && (
                    <div className={`pointer-events-none absolute -top-7 right-0 text-[11px] text-muted-foreground transition-opacity ${isExpanded ? "opacity-0" : "opacity-100"}`}>
                        <span className="max-w-[180px] truncate">{currentTrack.name}</span>
                    </div>
                )}
            </div>
        </div>
    );
}
