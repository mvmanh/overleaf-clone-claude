import type { Metadata } from 'next';
import { AppHeader } from '../../components/AppHeader';
import { ProjectList } from './ProjectList';

export const metadata: Metadata = { title: 'Projects' };

export default function ProjectsPage() {
  return (
    <>
      <AppHeader />
      <main id="main" className="page">
        <h1 className="page__title">Projects</h1>
        <p className="page__subtitle">Projects you own or that were shared with you.</p>
        <ProjectList />
      </main>
    </>
  );
}
