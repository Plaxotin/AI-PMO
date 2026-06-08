import TeamBoardDashboard from '@/components/dashboard/TeamBoardDashboard';

export const metadata = {
  title: 'Дашборд программы цифровизации — AI PMO',
  description:
    'Мокап: рабочие группы, ОФС команды, поручения, итоговые документы и загрузка',
};

export default function DashboardPage() {
  return <TeamBoardDashboard />;
}
