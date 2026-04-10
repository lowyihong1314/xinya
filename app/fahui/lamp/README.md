# Lamp

Lamp-registration backend modules grouped under the FAHUI domain.

## Modules
- `routes.py`: canonical lamp endpoints plus legacy `/lampRegistration_API/*` aliases.
- `services.py`: registration workflow plus lamp payment wrappers into the unified FAHUI payment system.
- `serializers.py`: response shaping for lamp registrations, while payment serialization now comes from the common review layer.

## Shared payment layer
- Lamp payment file storage still reuses [payment.py](/home/yukang/flaskapp/xinya/app/fahui/common/payment.py).
- Lamp payment review, deletion, and serialization now reuse [payment_review.py](/home/yukang/flaskapp/xinya/app/fahui/common/payment_review.py), with `type = lamp`.
