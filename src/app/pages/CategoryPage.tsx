import { Link, useParams } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { getCategory, isCategoryId } from '@/tools/categories';
import { toolsInCategory } from '@/tools/registry';
import { ToolGrid } from '@/components/ToolCard';
import { ToolIcon } from '@/components/ToolIcon';
import { useDocumentTitle } from '../useDocumentTitle';
import { NotFoundPage } from './NotFoundPage';

export function CategoryPage() {
  const { categoryId = '' } = useParams();
  const valid = isCategoryId(categoryId);
  const category = valid ? getCategory(categoryId) : null;
  useDocumentTitle(category ? `${category.name} tools` : 'Category not found');
  if (!category) return <NotFoundPage message={`There is no “${categoryId}” category.`} />;
  const tools = toolsInCategory(category.id);

  return (
    <div className="mx-auto max-w-[1240px] px-4 pt-5 pb-16 sm:px-6 lg:px-8">
      <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1 text-[12.5px] text-fg-muted">
        <Link to="/" className="hover:text-fg">
          Home
        </Link>
        <ChevronRight size={13} aria-hidden />
        <Link to="/tools" className="hover:text-fg">
          All tools
        </Link>
      </nav>
      <header className="mb-6 flex items-start gap-4">
        <ToolIcon icon={category.icon} hue={category.hue} size="lg" />
        <div>
          <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-fg">{category.name}</h1>
          <p className="mt-1 text-[14px] text-fg-secondary">{category.description}</p>
        </div>
      </header>
      {tools.length ? (
        <ToolGrid tools={tools} />
      ) : (
        <p className="text-sm text-fg-muted">This category has no tools yet.</p>
      )}
    </div>
  );
}
