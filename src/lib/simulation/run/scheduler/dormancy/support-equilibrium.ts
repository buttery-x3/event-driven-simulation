import type { Vec2 } from '../../../contracts';
import { solveNonnegativeLeastSquares } from '../../dynamic-impact/nonnegative-qp';
import type { ActiveComponentContact, ExactTimeComponent } from '../pairs/component';

export interface SupportReactionSolution {
	readonly contacts: readonly ActiveComponentContact[];
	readonly reactions: readonly number[];
	readonly residualNorm: number;
}

export function certifySupportEquilibrium(
	bodies: ExactTimeComponent['bodies'],
	contacts: readonly ActiveComponentContact[],
	gravity: Vec2,
	tolerance: number
): SupportReactionSolution | null {
	if (!contacts.some((contact) => contact.type === 'body-fixed')) return null;
	const orderedBodies = [...bodies].sort((left, right) => left.id.localeCompare(right.id));
	const bodyIndex = new Map(orderedBodies.map((body, index) => [body.id, index]));
	const orderedContacts = [...contacts].sort((left, right) => left.id.localeCompare(right.id));
	const dimensions = orderedBodies.length * 2;
	const columns = orderedContacts.map((contact) => {
		const column = Array.from({ length: dimensions }, () => 0);
		if (contact.type === 'body-fixed') {
			const offset = bodyIndex.get(contact.bodyId)! * 2;
			column[offset] = contact.normal[0];
			column[offset + 1] = contact.normal[1];
		} else {
			const first = bodyIndex.get(contact.firstBodyId)! * 2;
			const second = bodyIndex.get(contact.secondBodyId)! * 2;
			column[first] = cleanZero(-contact.normalFromFirstToSecond[0]);
			column[first + 1] = cleanZero(-contact.normalFromFirstToSecond[1]);
			column[second] = contact.normalFromFirstToSecond[0];
			column[second + 1] = contact.normalFromFirstToSecond[1];
		}
		return column;
	});
	const target = orderedBodies.flatMap(({ mass }) => [-mass * gravity[0], -mass * gravity[1]]);
	const solution = solveNonnegativeLeastSquares(columns, target, tolerance);
	if (!solution) return null;
	const forceScale = Math.max(1, ...target.map(Math.abs));
	if (solution.residualNorm > tolerance * forceScale * Math.max(64, dimensions * 16)) return null;
	return {
		contacts: orderedContacts,
		reactions: solution.values.map((value) => (Math.abs(value) <= tolerance ? 0 : value)),
		residualNorm: solution.residualNorm
	};
}

function cleanZero(value: number): number {
	return value === 0 ? 0 : value;
}
