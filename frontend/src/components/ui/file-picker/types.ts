export interface FormatOption {
  label: string;
  value: string;
  extension: string;
}

export interface FilePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'select' | 'create';
  type: 'file' | 'directory' | 'both';
  title?: string;
  defaultPath?: string;
  defaultFilename?: string;
  fileFilter?: FileFilter[];
  onSelect: (path: string, format?: string) => void;
  onCancel?: () => void;
  formatOptions?: FormatOption[];
  defaultFormat?: string;
  customShortcut?: { name: string; path: string; icon: string };
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface FilePickerItem {
  name: string;
  path: string;
  is_directory: boolean;
  size: number | null;
  modified_at: number;
}

export interface CommonDirectory {
  name: string;
  path: string;
  icon: string;
}

export interface FilePickerState {
  currentPath: string;
  parentPath: string | null;
  files: FilePickerItem[];
  selectedItem: FilePickerItem | null;
  loading: boolean;
  error: string | null;
  filename: string;
  showHidden: boolean;
}
