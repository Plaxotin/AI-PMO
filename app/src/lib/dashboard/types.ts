export type TaskStatus = 'not_started' | 'in_progress' | 'review' | 'done' | 'overdue';
export type DocStatus = 'draft' | 'in_progress' | 'review' | 'approved' | 'overdue';
export type AssignmentSource = 'tracker' | 'schedule';

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  responsibilities: string[];
}

export interface Assignment {
  id: string;
  title: string;
  source: AssignmentSource;
  ownerId: string;
  dueDate: string;
  status: TaskStatus;
  scheduleRef?: string;
}

export interface DeliverableDoc {
  id: string;
  code: string;
  title: string;
  ownerId: string;
  dueDate: string;
  status: DocStatus;
}

export interface WorkingGroup {
  id: string;
  name: string;
  shortName: string;
  leaderId: string;
  members: TeamMember[];
  assignments: Assignment[];
  documents: DeliverableDoc[];
}

export interface ProgramInfo {
  name: string;
  period: string;
  sponsor: string;
}
