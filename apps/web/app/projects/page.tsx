import type { Metadata } from 'next';
import { AppHeader } from '../../components/AppHeader';
import { ProjectList } from './ProjectList';

export const metadata: Metadata = { title: 'Projects' };

export default function ProjectsPage() {
  return (
    <>
      <AppHeader />
      <main id="main" className="page">
        <ProjectList />
      </main>
    </>
  );
}
