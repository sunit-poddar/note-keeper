import json

from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import UserCreationForm
from django.http import Http404, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from .models import Note


@login_required
def editor(request):
    return render(request, 'editor.html')


@login_required
@require_http_methods(['GET'])
def api_note_list(request):
    notes = (
        Note.objects
        .filter(author=request.user)
        .order_by('-updated_at')
        .values('id', 'title', 'updated_at', 'is_public', 'slug')
    )
    return JsonResponse({'notes': list(notes)})


@login_required
@require_http_methods(['POST'])
def api_note_create(request):
    note = Note.objects.create(author=request.user, title='Untitled', text='')
    return JsonResponse({
        'id': note.id,
        'title': note.title,
        'text': note.text,
        'updated_at': note.updated_at.isoformat(),
    }, status=201)


@login_required
@require_http_methods(['GET'])
def api_note_detail(request, note_id):
    note = get_object_or_404(Note, id=note_id, author=request.user)
    return JsonResponse({
        'id': note.id,
        'title': note.title,
        'text': note.text,
        'is_public': note.is_public,
        'slug': note.slug,
        'created_at': note.created_at.isoformat(),
        'updated_at': note.updated_at.isoformat(),
    })


@login_required
@require_http_methods(['POST'])
def api_note_save(request, note_id):
    body = json.loads(request.body)
    now = timezone.now()
    fields = {'updated_at': now}
    if 'title' in body:
        fields['title'] = body['title']
    if 'text' in body:
        fields['text'] = body['text']
    rows = Note.objects.filter(id=note_id, author=request.user).update(**fields)
    if not rows:
        raise Http404
    return JsonResponse({'ok': True, 'updated_at': now.isoformat()})


@login_required
@require_http_methods(['POST'])
def api_note_delete(request, note_id):
    count, _ = Note.objects.filter(id=note_id, author=request.user).delete()
    if not count:
        raise Http404
    return JsonResponse({'ok': True})


@login_required
@require_http_methods(['POST'])
def api_note_publish(request, note_id):
    note = get_object_or_404(Note, id=note_id, author=request.user)
    slug = note.publish()
    return JsonResponse({'ok': True, 'slug': slug, 'public_url': f'/note/{slug}/'})


def public_note(request, note_slug):
    note = get_object_or_404(Note, slug=note_slug, is_public=True)
    return render(request, 'public_note.html', {'note': note})


def register(request):
    if request.method == 'POST':
        form = UserCreationForm(request.POST)
        if form.is_valid():
            user = form.save()
            login(request, user)
            return redirect('editor')
    else:
        form = UserCreationForm()
    return render(request, 'registration/register.html', {'form': form})
