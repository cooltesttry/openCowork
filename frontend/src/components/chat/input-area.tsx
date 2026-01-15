import { useState, KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SendIcon } from "lucide-react";

interface InputAreaProps {
    onSend: (message: string) => void;
    disabled?: boolean;
}

export function InputArea({ onSend, disabled }: InputAreaProps) {
    const [content, setContent] = useState("");

    const handleSend = () => {
        if (content.trim() && !disabled) {
            onSend(content.trim());
            setContent("");
        }
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="p-4 border-t bg-background">
            <div className="flex gap-2 max-w-4xl mx-auto">
                <Textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a message..."
                    className="min-h-[50px] max-h-[200px] resize-none"
                    disabled={disabled}
                />
                <Button
                    onClick={handleSend}
                    disabled={disabled || !content.trim()}
                    size="icon"
                    className="h-[50px] w-[50px] shrink-0"
                >
                    <SendIcon className="h-5 w-5" />
                </Button>
            </div>
        </div>
    );
}
