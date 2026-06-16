import json

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from .models import Note


class NoteTestBase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='alice', password='pass')
        self.other = User.objects.create_user(username='bob', password='pass')
        self.client.force_login(self.user)

    def make_note(self, author=None, **kwargs):
        return Note.objects.create(author=author or self.user, **kwargs)


class NoteModelTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='alice', password='pass')

    def test_defaults(self):
        note = Note.objects.create(author=self.user)
        self.assertEqual(note.title, 'Untitled')
        self.assertEqual(note.text, '')
        self.assertFalse(note.is_public)
        self.assertIsNone(note.slug)

    def test_timestamps_set_on_create(self):
        note = Note.objects.create(author=self.user)
        self.assertIsNotNone(note.created_at)
        self.assertIsNotNone(note.updated_at)

    def test_updated_at_changes_on_save(self):
        note = Note.objects.create(author=self.user)
        original = note.updated_at
        note.title = 'Changed'
        note.save()
        note.refresh_from_db()
        self.assertGreaterEqual(note.updated_at, original)

    def test_publish_sets_public_and_slug(self):
        note = Note.objects.create(author=self.user, title='My Note')
        slug = note.publish()
        self.assertTrue(note.is_public)
        self.assertIsNotNone(slug)
        self.assertTrue(len(slug) > 0)

    def test_publish_slug_from_title(self):
        note = Note.objects.create(author=self.user, title='Hello World')
        slug = note.publish()
        self.assertEqual(slug, 'hello-world')


class AuthRedirectTests(TestCase):
    def _assert_redirects_to_login(self, method, url, **kwargs):
        response = getattr(self.client, method)(url, **kwargs)
        self.assertIn(response.status_code, (301, 302))
        self.assertIn('/accounts/login/', response['Location'])

    def test_editor_redirects(self):
        self._assert_redirects_to_login('get', reverse('editor'))

    def test_api_note_list_redirects(self):
        self._assert_redirects_to_login('get', reverse('api_note_list'))

    def test_api_note_create_redirects(self):
        self._assert_redirects_to_login('post', reverse('api_note_create'))

    def test_api_note_detail_redirects(self):
        self._assert_redirects_to_login('get', reverse('api_note_detail', args=[1]))

    def test_api_note_save_redirects(self):
        self._assert_redirects_to_login('post', reverse('api_note_save', args=[1]),
                                        data=json.dumps({}), content_type='application/json')

    def test_api_note_delete_redirects(self):
        self._assert_redirects_to_login('post', reverse('api_note_delete', args=[1]))

    def test_api_note_publish_redirects(self):
        self._assert_redirects_to_login('post', reverse('api_note_publish', args=[1]))


class NoteAPITests(NoteTestBase):
    def test_note_list_empty(self):
        response = self.client.get(reverse('api_note_list'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'notes': []})

    def test_note_list_returns_own_notes_only(self):
        own = self.make_note(title='Mine')
        self.make_note(author=self.other, title='Not mine')
        response = self.client.get(reverse('api_note_list'))
        ids = [n['id'] for n in response.json()['notes']]
        self.assertIn(own.id, ids)
        self.assertEqual(len(ids), 1)

    def test_note_list_ordered_by_updated_at(self):
        first = self.make_note(title='First')
        second = self.make_note(title='Second')
        # touch second so it has a later updated_at
        second.title = 'Second updated'
        second.save()
        response = self.client.get(reverse('api_note_list'))
        ids = [n['id'] for n in response.json()['notes']]
        self.assertEqual(ids[0], second.id)

    def test_create_returns_201(self):
        response = self.client.post(reverse('api_note_create'))
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertIn('id', data)
        self.assertIn('title', data)
        self.assertIn('updated_at', data)

    def test_create_persists_note(self):
        self.client.post(reverse('api_note_create'))
        self.assertEqual(Note.objects.filter(author=self.user).count(), 1)

    def test_detail_returns_note(self):
        note = self.make_note(title='Detail test', text='body')
        response = self.client.get(reverse('api_note_detail', args=[note.id]))
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['id'], note.id)
        self.assertEqual(data['title'], 'Detail test')
        self.assertEqual(data['text'], 'body')

    def test_detail_404_for_other_users_note(self):
        note = self.make_note(author=self.other)
        response = self.client.get(reverse('api_note_detail', args=[note.id]))
        self.assertEqual(response.status_code, 404)

    def test_save_updates_fields(self):
        note = self.make_note(title='Old', text='old text')
        payload = json.dumps({'title': 'New', 'text': 'new text'})
        response = self.client.post(
            reverse('api_note_save', args=[note.id]),
            data=payload,
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        note.refresh_from_db()
        self.assertEqual(note.title, 'New')
        self.assertEqual(note.text, 'new text')

    def test_save_returns_updated_at(self):
        note = self.make_note()
        payload = json.dumps({'title': 'Updated'})
        response = self.client.post(
            reverse('api_note_save', args=[note.id]),
            data=payload,
            content_type='application/json',
        )
        self.assertIn('updated_at', response.json())

    def test_save_404_for_other_users_note(self):
        note = self.make_note(author=self.other)
        payload = json.dumps({'title': 'Hacked'})
        response = self.client.post(
            reverse('api_note_save', args=[note.id]),
            data=payload,
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 404)

    def test_delete_removes_note(self):
        note = self.make_note()
        response = self.client.post(reverse('api_note_delete', args=[note.id]))
        self.assertEqual(response.status_code, 200)
        self.assertFalse(Note.objects.filter(id=note.id).exists())

    def test_delete_404_for_other_users_note(self):
        note = self.make_note(author=self.other)
        response = self.client.post(reverse('api_note_delete', args=[note.id]))
        self.assertEqual(response.status_code, 404)
        self.assertTrue(Note.objects.filter(id=note.id).exists())

    def test_publish_sets_public_url(self):
        note = self.make_note(title='My Public Note')
        response = self.client.post(reverse('api_note_publish', args=[note.id]))
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn('public_url', data)
        self.assertTrue(data['public_url'].startswith('/note/'))

    def test_publish_makes_note_public(self):
        note = self.make_note(title='Public Note')
        self.client.post(reverse('api_note_publish', args=[note.id]))
        note.refresh_from_db()
        self.assertTrue(note.is_public)

    def test_publish_404_for_other_users_note(self):
        note = self.make_note(author=self.other, title='Other Note')
        response = self.client.post(reverse('api_note_publish', args=[note.id]))
        self.assertEqual(response.status_code, 404)


class PublicNoteTests(TestCase):
    def setUp(self):
        self.author = User.objects.create_user(username='author', password='pass')

    def test_public_note_accessible(self):
        note = Note.objects.create(author=self.author, title='Public', text='hello', is_public=True, slug='public')
        response = self.client.get(reverse('public_note', args=['public']))
        self.assertEqual(response.status_code, 200)

    def test_unpublished_note_returns_404(self):
        Note.objects.create(author=self.author, title='Private', is_public=False, slug='private')
        response = self.client.get(reverse('public_note', args=['private']))
        self.assertEqual(response.status_code, 404)

    def test_nonexistent_slug_returns_404(self):
        response = self.client.get(reverse('public_note', args=['no-such-note']))
        self.assertEqual(response.status_code, 404)


class RegisterViewTests(TestCase):
    def test_register_get(self):
        response = self.client.get(reverse('register'))
        self.assertEqual(response.status_code, 200)

    def test_register_post_creates_user_and_redirects(self):
        response = self.client.post(reverse('register'), {
            'username': 'newuser',
            'password1': 'Testpass123!',
            'password2': 'Testpass123!',
        })
        self.assertRedirects(response, reverse('editor'))
        self.assertTrue(User.objects.filter(username='newuser').exists())

    def test_register_post_invalid(self):
        response = self.client.post(reverse('register'), {
            'username': 'newuser',
            'password1': 'Testpass123!',
            'password2': 'wrongpass',
        })
        self.assertEqual(response.status_code, 200)
        self.assertFalse(User.objects.filter(username='newuser').exists())
