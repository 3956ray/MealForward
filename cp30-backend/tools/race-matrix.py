"""Real HTTPS two-API barriers over shared PG; explicit partial C06/C07 evidence."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import signal
import sys
import threading
from smoke import Harness, IntegrationFailure


def fund(h, client, store):
    review = client.ok('POST', '/v1/support/reviews', {'store': store, 'meal': 'meal', 'quantity': 1})
    intent = client.ok('POST', '/v1/support/intents', {'reviewId': review['reviewId']})
    h.actor(intent['id'], '0x'+format(0x71, '040x'))
    h.terminal(client, intent['id'])


def race(h, group, round_number):
    h.new_case(group.lower())
    alice = h.login('alice', 'a')
    other = h.login('same' if group == 'C06' else 'bob', 'b')
    fund(h, alice, 'S1')
    if group == 'C06':
        fund(h, alice, 'S2')
    clients = [alice, other]
    stores = ['S1', 'S2' if group == 'C06' else 'S1']
    reviews = [client.ok('POST', '/v1/claims/reviews', {'store': store, 'meal': 'meal'})
               for client, store in zip(clients, stores)]
    before = h.b.call('fixture_snapshot', h.namespace, {})
    barrier = threading.Barrier(2, timeout=3)

    def submit(index):
        barrier.wait()
        return clients[index].request('POST', '/v1/claims/intents', {'reviewId': reviews[index]['reviewId']})

    # Isolate the two API commit race from subsequent source execution, retaining
    # both actual worker OS processes and resuming them immediately afterward.
    h.workers_signal(signal.SIGSTOP)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(submit, i) for i in range(2)]
            responses = [future.result(timeout=8) for future in futures]
        accepted = [i for i, (status, _) in enumerate(responses) if status == 200]
        if len(accepted) != 1:
            raise IntegrationFailure(group+':ACCEPT_COUNT')
        loser = responses[1-accepted[0]]
        if loser[0] != 409 or loser[1].get('error') not in {'CONFLICT', 'PENDING_OR_COOLDOWN'}:
            raise IntegrationFailure(group+':REJECTION_KIND')
        reserved = h.b.call('fixture_snapshot', h.namespace, {})
        assert reserved['reservations'] == 1 and reserved['pendingEmails'] == 1 and reserved['pendingSubjects'] == 1
    finally:
        h.workers_signal(signal.SIGCONT)
    winner = accepted[0]
    final = h.terminal(clients[winner], responses[winner][1]['id'])
    after = h.b.call('fixture_snapshot', h.namespace, {})
    assert after['vouchers'] == 1 and after['reservations'] == after['pendingEmails'] == after['pendingSubjects'] == 0
    h.records.append({'scenario': group, 'round': round_number, 'status': 'PASS',
                      'apiPorts': [clients[0].port, clients[1].port], 'winner': winner,
                      'responses': [{'status': status, 'error': body.get('error'), 'stage': body.get('stage')}
                                    for status, body in responses],
                      'before': before, 'reserved': reserved, 'after': after, 'originalResult': final['result']})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('run')
    args = parser.parse_args()
    h = Harness(args.run)
    status, reason = 'FAIL', None
    try:
        h.start()
        h.flow()
        for group in ['C06', 'C07_LAST_UNIT']:
            for round_number in range(1, 21):
                race(h, group, round_number)
            print(group+':20/20', flush=True)
        status = 'PASS'
    except IntegrationFailure as exc:
        reason = str(exc)
    except Exception as exc:
        reason = 'MATRIX_EXCEPTION:'+type(exc).__name__
    finally:
        try:
            h.workers_signal(signal.SIGCONT)
            h.close()
        except Exception as exc:
            status, reason = 'FAIL', 'TEARDOWN:'+type(exc).__name__
        h.evidence(status, reason)
    return 0 if status == 'PASS' else 1


if __name__ == '__main__':
    sys.exit(main())
