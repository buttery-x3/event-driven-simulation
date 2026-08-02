import { continueCircularContact } from './circular-contact';
import { unresolvedContactResult } from './contact-mode-results';
import { continueLineContact } from './linear-contact';
import type { SustainedContactRequest, SustainedContactResult } from './types';

export function continueSustainedContact(request: SustainedContactRequest): SustainedContactResult {
	const collider = request.input.scene.staticColliders.find(
		(candidate) => candidate.id === request.colliderId
	);
	if (!collider) {
		return unresolvedContactResult(request, 'The supporting collider no longer exists.');
	}

	if (!('centre' in collider)) {
		return continueLineContact(request, collider);
	}

	return continueCircularContact(
		request,
		collider.centre,
		collider.physicalShape.radius + request.body.physicalShape.radius
	);
}
