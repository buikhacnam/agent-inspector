export type Condition =
  | { type: 'key_fact_present'; fact: string }
  | { type: 'key_fact_absent'; fact: string }
  | { type: 'message_count_gte'; value: number }
  | { type: 'intent_detected'; value: string }
  | { type: 'form_field_collected'; field: string }
  | { type: 'last_user_message_matches'; pattern: string }
  | { type: 'all_of'; conditions: Condition[] }
  | { type: 'any_of'; conditions: Condition[] }
  | { type: 'not'; condition: Condition };

export type Action =
  | { type: 'system_message'; text: string }
  | { type: 'ai_message'; prompt?: string }
  | { type: 'form'; formId: string; form?: Form; collected?: Record<string, string> }
  | { type: 'buttons'; options: ButtonOption[] }
  | { type: 'switch'; toBlockId: string }
  | { type: 'http'; method: string; url: string; body?: unknown }
  | { type: 'end_chat'; text?: string };

export interface ButtonOption {
  id: string;
  label: string;
  action: Action;
}

export interface Director {
  id: string;
  when: Condition;
  then: Action;
}

export interface Block {
  id: string;
  persona?: string;
  knowledgeNamespaces?: string[];
  tools?: string[];
  firstAction?: Action;
  directors?: Director[];
}

export interface FormField {
  name: string;
  label: string;
  required?: boolean;
  validate?: 'email' | 'phone';
}

export interface Form {
  id: string;
  fields: FormField[];
  submitActions: Action[];
}

export interface Workflow {
  version: number;
  startBlockId: string;
  blocks: Block[];
  forms: Form[];
  tools?: string[];
}

export interface SessionState {
  keyFacts?: Record<string, string>;
  formState?: { formId: string; collected: Record<string, string> };
  pendingButtons?: { options: ButtonOption[] };
  intent?: string;
  sentiment?: string;
  directorsMatched?: string[];
}

export type MessageInput =
  | { type: 'text'; text: string }
  | { type: 'form'; values: Record<string, string> }
  | { type: 'button'; buttonId: string };
