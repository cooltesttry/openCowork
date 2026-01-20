"use client";

import { useState, useEffect, useCallback } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AskUserQuestionItem } from "@/lib/websocket";
import { HelpCircle, Clock } from "lucide-react";

interface AskUserDialogProps {
    open: boolean;
    requestId: string;
    questions: AskUserQuestionItem[];
    timeout: number;
    onSubmit: (requestId: string, answers: Record<string, string>) => void;
    onCancel: (requestId: string) => void;
}

export function AskUserDialog({
    open,
    requestId,
    questions,
    timeout,
    onSubmit,
    onCancel,
}: AskUserDialogProps) {
    // Track answers for each question
    const [answers, setAnswers] = useState<Record<string, string>>({});
    // Track custom "Other" input for each question
    const [otherInputs, setOtherInputs] = useState<Record<string, string>>({});
    // Track if "Other" is selected for each question
    const [useOther, setUseOther] = useState<Record<string, boolean>>({});
    // Countdown timer
    const [timeRemaining, setTimeRemaining] = useState(timeout);

    // Reset state when dialog opens
    useEffect(() => {
        if (open) {
            setAnswers({});
            setOtherInputs({});
            setUseOther({});
            setTimeRemaining(timeout);
        }
    }, [open, timeout]);

    // Countdown timer
    useEffect(() => {
        if (!open) return;

        const interval = setInterval(() => {
            setTimeRemaining((prev) => {
                if (prev <= 1) {
                    clearInterval(interval);
                    onCancel(requestId);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [open, requestId, onCancel]);

    // Handle single-select answer
    const handleSingleSelect = (questionText: string, value: string) => {
        if (value === "__other__") {
            setUseOther((prev) => ({ ...prev, [questionText]: true }));
            setAnswers((prev) => ({ ...prev, [questionText]: otherInputs[questionText] || "" }));
        } else {
            setUseOther((prev) => ({ ...prev, [questionText]: false }));
            setAnswers((prev) => ({ ...prev, [questionText]: value }));
        }
    };

    // Handle multi-select answer
    const handleMultiSelect = (questionText: string, label: string, checked: boolean) => {
        setAnswers((prev) => {
            const current = prev[questionText]?.split(", ").filter(Boolean) || [];
            let updated: string[];

            if (checked) {
                updated = [...current, label];
            } else {
                updated = current.filter((l) => l !== label);
            }

            return { ...prev, [questionText]: updated.join(", ") };
        });
    };

    // Handle other input change
    const handleOtherInput = (questionText: string, value: string) => {
        setOtherInputs((prev) => ({ ...prev, [questionText]: value }));
        if (useOther[questionText]) {
            setAnswers((prev) => ({ ...prev, [questionText]: value }));
        }
    };

    // Check if all questions are answered
    const isComplete = questions.every((q) => {
        const answer = answers[q.question];
        return answer && answer.trim().length > 0;
    });

    const handleSubmit = () => {
        if (isComplete) {
            onSubmit(requestId, answers);
        }
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, "0")}`;
    };

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel(requestId)}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <HelpCircle className="h-5 w-5 text-primary" />
                        Claude has a question
                    </DialogTitle>
                    <DialogDescription className="flex items-center gap-2 text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        <span className={timeRemaining < 15 ? "text-destructive font-medium" : ""}>
                            {formatTime(timeRemaining)} remaining
                        </span>
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="max-h-[400px] pr-4">
                    <div className="space-y-6">
                        {questions.map((q, index) => (
                            <div key={index} className="space-y-3">
                                {q.header && (
                                    <div className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                                        {q.header}
                                    </div>
                                )}
                                <div className="font-medium">{q.question}</div>

                                {q.multiSelect ? (
                                    // Multi-select checkboxes
                                    <div className="space-y-2">
                                        {q.options.map((opt) => (
                                            <div key={opt.label} className="flex items-start gap-3">
                                                <Checkbox
                                                    id={`${index}-${opt.label}`}
                                                    checked={answers[q.question]?.includes(opt.label) || false}
                                                    onCheckedChange={(checked) =>
                                                        handleMultiSelect(q.question, opt.label, !!checked)
                                                    }
                                                />
                                                <div className="grid gap-1 leading-none">
                                                    <Label
                                                        htmlFor={`${index}-${opt.label}`}
                                                        className="text-sm font-medium cursor-pointer"
                                                    >
                                                        {opt.label}
                                                    </Label>
                                                    {opt.description && (
                                                        <p className="text-xs text-muted-foreground">
                                                            {opt.description}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    // Single-select radio buttons
                                    <RadioGroup
                                        value={useOther[q.question] ? "__other__" : (answers[q.question] || "")}
                                        onValueChange={(value) => handleSingleSelect(q.question, value)}
                                    >
                                        {q.options.map((opt) => (
                                            <div key={opt.label} className="flex items-start gap-3">
                                                <RadioGroupItem
                                                    value={opt.label}
                                                    id={`${index}-${opt.label}`}
                                                />
                                                <div className="grid gap-1 leading-none">
                                                    <Label
                                                        htmlFor={`${index}-${opt.label}`}
                                                        className="text-sm font-medium cursor-pointer"
                                                    >
                                                        {opt.label}
                                                    </Label>
                                                    {opt.description && (
                                                        <p className="text-xs text-muted-foreground">
                                                            {opt.description}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        ))}

                                        {/* Other option */}
                                        <div className="flex items-start gap-3">
                                            <RadioGroupItem value="__other__" id={`${index}-other`} />
                                            <div className="flex-1 space-y-2">
                                                <Label
                                                    htmlFor={`${index}-other`}
                                                    className="text-sm font-medium cursor-pointer"
                                                >
                                                    Other
                                                </Label>
                                                {useOther[q.question] && (
                                                    <Input
                                                        placeholder="Type your answer..."
                                                        value={otherInputs[q.question] || ""}
                                                        onChange={(e) =>
                                                            handleOtherInput(q.question, e.target.value)
                                                        }
                                                        autoFocus
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    </RadioGroup>
                                )}
                            </div>
                        ))}
                    </div>
                </ScrollArea>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onCancel(requestId)}>
                        Skip
                    </Button>
                    <Button onClick={handleSubmit} disabled={!isComplete}>
                        Submit Answer
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
