import type { Vec2 } from '../../contracts';
import { dotVec2 } from '../../math';

export interface IsolatedBodyImpactInput {
	readonly firstMass: number;
	readonly secondMass: number;
	readonly firstVelocity: Vec2;
	readonly secondVelocity: Vec2;
	readonly normalFromFirstToSecond: Vec2;
	readonly restitution: number;
	readonly tolerance: number;
}

export interface IsolatedBodyImpactResponse {
	readonly impulseMagnitude: number;
	readonly firstVelocity: Vec2;
	readonly secondVelocity: Vec2;
	readonly preImpactNormalVelocity: number;
	readonly postImpactNormalVelocity: number;
}

export type IsolatedBodyImpactResult =
	| { readonly type: 'response'; readonly response: IsolatedBodyImpactResponse }
	| { readonly type: 'rejected'; readonly reason: string };

export function resolveIsolatedBodyImpact(
	input: IsolatedBodyImpactInput
): IsolatedBodyImpactResult {
	const values = [
		input.firstMass,
		input.secondMass,
		...input.firstVelocity,
		...input.secondVelocity,
		...input.normalFromFirstToSecond,
		input.restitution,
		input.tolerance
	];
	if (!values.every(Number.isFinite)) return rejected('Impact input contains a non-finite value.');
	if (input.firstMass <= 0 || input.secondMass <= 0)
		return rejected('Body masses must be positive.');
	if (input.restitution < 0 || input.restitution > 1)
		return rejected('Restitution must lie in the closed interval [0, 1].');
	if (input.tolerance < 0) return rejected('Impact tolerance must be non-negative.');

	const normalLength = Math.hypot(...input.normalFromFirstToSecond);
	const tolerance = Math.max(input.tolerance, Number.EPSILON * 64);
	if (Math.abs(normalLength - 1) > tolerance)
		return rejected('The certified contact normal is not unit length.');

	const relativeVelocity: Vec2 = [
		input.secondVelocity[0] - input.firstVelocity[0],
		input.secondVelocity[1] - input.firstVelocity[1]
	];
	const incoming = dotVec2(relativeVelocity, input.normalFromFirstToSecond);
	if (!(incoming < 0)) return rejected('The certified impact is not incoming.');

	const inverseMass = 1 / input.firstMass + 1 / input.secondMass;
	const impulseMagnitude = (-(1 + input.restitution) * incoming) / inverseMass;
	if (!Number.isFinite(impulseMagnitude) || impulseMagnitude < 0)
		return rejected('The calculated impulse is non-finite or attractive.');

	const firstVelocity = applyImpulse(
		input.firstVelocity,
		input.normalFromFirstToSecond,
		-impulseMagnitude / input.firstMass
	);
	const secondVelocity = applyImpulse(
		input.secondVelocity,
		input.normalFromFirstToSecond,
		impulseMagnitude / input.secondMass
	);
	if (![...firstVelocity, ...secondVelocity].every(Number.isFinite))
		return rejected('The calculated post-impact state is non-finite.');

	const outgoingRelative: Vec2 = [
		secondVelocity[0] - firstVelocity[0],
		secondVelocity[1] - firstVelocity[1]
	];
	const outgoing = dotVec2(outgoingRelative, input.normalFromFirstToSecond);
	const scale = Math.max(
		1,
		Math.abs(incoming),
		Math.hypot(...input.firstVelocity),
		Math.hypot(...input.secondVelocity)
	);
	const numericalTolerance = tolerance * scale * 16;
	if (outgoing < -numericalTolerance)
		return rejected('The post-impact relative normal motion remains incoming.');
	if (Math.abs(outgoing + input.restitution * incoming) > numericalTolerance)
		return rejected('The post-impact state violates Newton restitution.');
	if (!momentumIsPreserved(input, firstVelocity, secondVelocity, numericalTolerance))
		return rejected('The post-impact state does not preserve momentum.');
	if (!tangentialMotionIsPreserved(input, firstVelocity, secondVelocity, numericalTolerance))
		return rejected('The normal impulse changed tangential motion.');
	if (!energyIsPlausible(input, firstVelocity, secondVelocity, numericalTolerance))
		return rejected('The post-impact state creates kinetic energy beyond tolerance.');

	return {
		type: 'response',
		response: {
			impulseMagnitude,
			firstVelocity,
			secondVelocity,
			preImpactNormalVelocity: incoming,
			postImpactNormalVelocity: outgoing
		}
	};
}

function applyImpulse(velocity: Vec2, normal: Vec2, scale: number): Vec2 {
	return [velocity[0] + scale * normal[0], velocity[1] + scale * normal[1]];
}

function momentumIsPreserved(
	input: IsolatedBodyImpactInput,
	firstVelocity: Vec2,
	secondVelocity: Vec2,
	tolerance: number
): boolean {
	for (const axis of [0, 1] as const) {
		const before =
			input.firstMass * input.firstVelocity[axis] + input.secondMass * input.secondVelocity[axis];
		const after = input.firstMass * firstVelocity[axis] + input.secondMass * secondVelocity[axis];
		if (Math.abs(after - before) > tolerance * Math.max(1, Math.abs(before))) return false;
	}
	return true;
}

function tangentialMotionIsPreserved(
	input: IsolatedBodyImpactInput,
	firstVelocity: Vec2,
	secondVelocity: Vec2,
	tolerance: number
): boolean {
	const tangent: Vec2 = [-input.normalFromFirstToSecond[1], input.normalFromFirstToSecond[0]];
	return (
		Math.abs(dotVec2(firstVelocity, tangent) - dotVec2(input.firstVelocity, tangent)) <=
			tolerance &&
		Math.abs(dotVec2(secondVelocity, tangent) - dotVec2(input.secondVelocity, tangent)) <= tolerance
	);
}

function energyIsPlausible(
	input: IsolatedBodyImpactInput,
	firstVelocity: Vec2,
	secondVelocity: Vec2,
	tolerance: number
): boolean {
	const before =
		0.5 * input.firstMass * dotVec2(input.firstVelocity, input.firstVelocity) +
		0.5 * input.secondMass * dotVec2(input.secondVelocity, input.secondVelocity);
	const after =
		0.5 * input.firstMass * dotVec2(firstVelocity, firstVelocity) +
		0.5 * input.secondMass * dotVec2(secondVelocity, secondVelocity);
	return after <= before + tolerance * Math.max(1, before);
}

function rejected(reason: string): IsolatedBodyImpactResult {
	return { type: 'rejected', reason };
}
