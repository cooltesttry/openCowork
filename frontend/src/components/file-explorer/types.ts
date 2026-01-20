export interface FileEntry {
    name: string;
    path: string;
    is_directory: boolean;
    size?: number | null;
    modified_at?: number | null;
    children?: FileEntry[];
}
