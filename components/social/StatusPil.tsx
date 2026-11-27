import { STATUS_LABEL } from '@/lib/social/kern';
import type { PostStatus } from '@/lib/social/types';

export function StatusPil({ status }: { status: PostStatus }) {
  return <span className={`so-pil so-pil-${status}`}>{STATUS_LABEL[status]}</span>;
}
