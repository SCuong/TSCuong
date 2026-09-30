import { Link, useParams } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { getCategory, isCategoryId } from '@/tools/categories';
import { toolsInCategory } from '@/tools/registry';
import { ToolGrid } from '@/components/ToolCard';
import { ToolIcon } from '@/components/ToolIcon';
import { useDocumentTitle } from '../useDocumentTitle';
import { NotFoundPage } from './NotFoundPage';
import { t } from '@/lib/i18n';

export function CategoryPage() {
  const { categoryId = '' } = useParams();
  const valid = isCategoryId(categoryId);
  const category = valid ? getCategory(categoryId) : null;
  useDocumentTitle(category ? t('{category} tools', { category: t(category.name) }) : t('Category not found'));
  if (!category) return <NotFoundPage message={t('There is no “{categoryId}” category.', { categoryId })} />;
  const tools = toolsInCategory(category.id);

  return (
    <div className="mx-auto max-w-[1240px] px-4 pt-5 pb-16 sm:px-6 lg:px-8">
      <nav aria-label={t('Breadcrumb')} className="mb-3 flex items-center gap-1 text-[12.5px] text-fg-muted">
        <Link to="/" className="hover:text-fg">
          {t('Home')}
        </Link>
        <ChevronRight size={13} aria-hidden />
        <Link to="/tools" className="hover:text-fg">
          {t('All tools')}
        </Link>
      </nav>
      <header className="mb-6 flex items-start gap-4">
        <ToolIcon icon={category.icon} hue={category.hue} size="lg" />
        <div>
          <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-fg">{t(category.name)}</h1>
          <p className="mt-1 text-[14px] text-fg-secondary">{t(category.description)}</p>
        </div>
      </header>
      {tools.length ? (
        <ToolGrid tools={tools} />
      ) : (
        <p className="text-sm text-fg-muted">{t('This category has no tools yet.')}</p>
      )}
    </div>
  );
}
