"use client";

import { useState, useEffect, useCallback } from "react";
import { MessageBlock } from "@/lib/types";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { HelpCircle, Clock, CheckCircle, XCircle, Send } from "lucide-react";

interface QuestionOption {
    label: string;
    description?: string;
}

interface Question {
    question: string;
    header?: string;
    multiSelect?: boolean;
    options: QuestionOption[];
}

interface AskUserBlockProps {
    block: MessageBlock;
    onSubmit?: (requestId: string, answers: Record<string, string>) => void;
    onSkip?: (requestId: string) => void;
}

export function AskUserBlock({ block, onSubmit, onSkip }: AskUserBlockProps) {
    const { status, content, metadata } = block;
    const requestId = metadata?.requestId || block.id;
    const questions: Question[] = content?.input?.questions || [];
    const timeout = content?.input?.timeout || 60;

    // Check if already answered (from history)
    const savedAnswers = content?.result;
    // Detect skipped: status is error, OR is_error flag is true, OR result indicates no answer
    const isSkipped = status === 'error' || content?.is_error === true ||
        (typeof savedAnswers === 'string' && savedAnswers.includes('did not provide'));
    // Detect answered: status is success with any result (string 'User has answered...' or object)
    // Must NOT be skipped
    const isAnswered = status === 'success' && savedAnswers && !isSkipped;
    const isPending = !isAnswered && !isSkipped && (status === 'pending' || status === 'executing');

    // Form state
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [otherInputs, setOtherInputs] = useState<Record<string, string>>({});
    const [useOther, setUseOther] = useState<Record<string, boolean>>({});
    const [timeRemaining, setTimeRemaining] = useState(timeout);

    // Countdown timer (only when pending)
    useEffect(() => {
        if (!isPending) return;

        const interval = setInterval(() => {
            setTimeRemaining((prev: number) => {
                if (prev <= 1) {
                    clearInterval(interval);
                    onSkip?.(requestId);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [isPending, requestId, onSkip]);

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
        if (isComplete && onSubmit) {
            onSubmit(requestId, answers);
        }
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, "0")}`;
    };

    // Parse answers from string result format: 'User has answered your questions: "Q1"="A1", "Q2"="A2"'
    const parseAnswersFromString = (result: string): Record<string, string> => {
        const answers: Record<string, string> = {};
        // Match pattern: "question"="answer"
        const regex = /"([^"]+)"="([^"]+)"/g;
        let match;
        while ((match = regex.exec(result)) !== null) {
            answers[match[1]] = match[2];
        }
        return answers;
    };

    // Get answers as an object (parsed if string)
    const getAnswers = (): Record<string, string> => {
        if (typeof savedAnswers === 'object' && savedAnswers !== null) {
            return savedAnswers as Record<string, string>;
        }
        if (typeof savedAnswers === 'string') {
            return parseAnswersFromString(savedAnswers);
        }
        return {};
    };

    // Render answered state (from history)
    if (isAnswered) {
        const parsedAnswers = getAnswers();
        return (
            <div className="my-2 rounded-lg border border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10 p-4">
                <div className="flex items-center gap-2 mb-3">
                    <HelpCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                    <Badge variant="outline" className="text-green-600 dark:text-green-400 border-green-300 dark:border-green-700">
                        AskUserQuestion
                    </Badge>
                    <CheckCircle className="h-4 w-4 text-green-500 ml-auto" />
                    <span className="text-xs text-green-600 dark:text-green-400">Answered</span>
                </div>
                <div className="space-y-2 text-sm">
                    {questions.map((q, idx) => (
                        <div key={idx} className="border-l-2 border-green-300 dark:border-green-700 pl-3">
                            <div className="text-muted-foreground text-xs">{q.header || `Question ${idx + 1}`}</div>
                            <div className="font-medium">{q.question}</div>
                            <div className="text-green-600 dark:text-green-400">
                                → {parsedAnswers[q.question] || 'N/A'}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // Render skipped state
    if (isSkipped) {
        return (
            <div className="my-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10 p-4">
                <div className="flex items-center gap-2 mb-3">
                    <HelpCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                    <Badge variant="outline" className="text-red-600 dark:text-red-400 border-red-300 dark:border-red-700">
                        AskUserQuestion
                    </Badge>
                    <XCircle className="h-4 w-4 text-red-500 ml-auto" />
                    <span className="text-xs text-red-600 dark:text-red-400">Skipped / Timeout</span>
                </div>
                <div className="text-sm text-muted-foreground">
                    {questions.length} question(s) were not answered.
                </div>
            </div>
        );
    }

    // Render pending state (interactive form)
    return (
        <div className="my-2 rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-900/10 p-4">
            {/* Header */}
            <div className="flex items-center gap-2 mb-4">
                <HelpCircle className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                <Badge variant="outline" className="text-purple-600 dark:text-purple-400 border-purple-300 dark:border-purple-700">
                    AskUserQuestion
                </Badge>
                <div className="flex items-center gap-1 ml-auto">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className={cn(
                        "text-xs font-medium",
                        timeRemaining < 15 ? "text-red-500" : "text-muted-foreground"
                    )}>
                        {formatTime(timeRemaining)}
                    </span>
                </div>
            </div>

            {/* Questions */}
            <div className="space-y-5">
                {questions.map((q, index) => (
                    <div key={index} className="space-y-2">
                        {q.header && (
                            <div className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                                {q.header}
                            </div>
                        )}
                        <div className="font-medium text-sm">{q.question}</div>

                        {q.multiSelect ? (
                            // Multi-select checkboxes
                            <div className="space-y-2 pl-2">
                                {q.options.map((opt) => (
                                    <div key={opt.label} className="flex items-start gap-2">
                                        <Checkbox
                                            id={`${index}-${opt.label}`}
                                            checked={answers[q.question]?.includes(opt.label) || false}
                                            onCheckedChange={(checked) =>
                                                handleMultiSelect(q.question, opt.label, !!checked)
                                            }
                                        />
                                        <div className="grid gap-0.5 leading-none">
                                            <Label
                                                htmlFor={`${index}-${opt.label}`}
                                                className="text-sm cursor-pointer"
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
                                className="pl-2"
                            >
                                {q.options.map((opt) => (
                                    <div key={opt.label} className="flex items-start gap-2">
                                        <RadioGroupItem
                                            value={opt.label}
                                            id={`${index}-${opt.label}`}
                                        />
                                        <div className="grid gap-0.5 leading-none">
                                            <Label
                                                htmlFor={`${index}-${opt.label}`}
                                                className="text-sm cursor-pointer"
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
                                <div className="flex items-start gap-2">
                                    <RadioGroupItem value="__other__" id={`${index}-other`} />
                                    <div className="flex-1 space-y-1">
                                        <Label
                                            htmlFor={`${index}-other`}
                                            className="text-sm cursor-pointer"
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
                                                className="h-8 text-sm"
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

            {/* Actions */}
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-purple-200 dark:border-purple-800">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onSkip?.(requestId)}
                    className="text-muted-foreground"
                >
                    Skip
                </Button>
                <Button
                    size="sm"
                    onClick={handleSubmit}
                    disabled={!isComplete}
                    className="ml-auto gap-1"
                >
                    <Send className="h-3.5 w-3.5" />
                    Submit
                </Button>
            </div>
        </div>
    );
}
