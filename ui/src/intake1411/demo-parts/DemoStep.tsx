import type { DemoStepDescriptor } from './contracts'

export function DemoStep({ step, number }: { step: DemoStepDescriptor; number: number }) {
  return <li className="dp-step">
    <h4>{number}. {step.name}</h4>
    <dl><dt>Action</dt><dd>{step.action}</dd><dt>Expected result</dt><dd>{step.expectedResult}</dd></dl>
  </li>
}
