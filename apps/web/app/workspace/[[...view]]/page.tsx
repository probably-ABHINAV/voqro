import type {Metadata} from 'next';
import {WorkspaceApp} from '@/components/workspace-app';
export const metadata:Metadata={title:'Workspace',robots:{index:false,follow:false}};
export default function WorkspacePage(){return <WorkspaceApp/>;}
