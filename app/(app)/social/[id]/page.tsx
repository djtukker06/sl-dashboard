import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isUuid, vereisTeamlidPagina } from '@/lib/auth/team';
import { STATUS_LABEL } from '@/lib/social/kern';
import { accountsVoorPagina, postVoorPagina } from '@/lib/social/posts';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { Editor } from '@/components/social/Editor';
import { SocialNav } from '@/components/social/SocialNav';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Post · Social · Studio Levant' };

// Een bestaande post bewerken (of bekijken als hij al geplaatst is: dan alleen de notities).
export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lid = await vereisTeamlidPagina(`/social/${id}`);
  if (!isUuid(id)) notFound();
  const [{ accounts, melding }, { post }] = await Promise.all([accountsVoorPagina(lid), postVoorPagina(lid, id)]);
  if (!post && !melding) notFound();
  return (
    <div className="db so">
      <ModuleKop label={post ? STATUS_LABEL[post.status] : 'Social'} titel="Post" />
      <SocialNav actief={null} />
      <Editor key={post?.id ?? 'leeg'} accounts={accounts} post={post} startDatum={null} melding={melding} />
    </div>
  );
}
