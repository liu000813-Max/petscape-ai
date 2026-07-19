import { SandboxPayClient } from './SandboxPayClient';
import '../../payments/payments.css';
import '../../checkout/checkout.css';
export default async function SandboxPayPage({params}:{params:Promise<{id:string}>}){return <SandboxPayClient attemptId={(await params).id}/>;}
