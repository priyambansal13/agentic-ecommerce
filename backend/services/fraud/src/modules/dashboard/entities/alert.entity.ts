import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'alerts' })
export class AlertEntity {
  @PrimaryColumn('uuid') id: string;
  @Column('text', { name: 'subject_type' }) subjectType: string;
  @Column('text') subject: string;
  @Column('numeric', { precision: 4, scale: 2 }) score: string;
  @Column('text') decision: string;
  @Column('text') status: string;
  @Column('jsonb') rules: string[];
  @Column('timestamptz', { name: 'raised_at' }) raisedAt: Date;
}

export const ENTITIES = [AlertEntity];
